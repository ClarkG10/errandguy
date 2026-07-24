import { Body, Controller, Headers, HttpException, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { Prisma, Payment } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../../messaging/notification.service';
import { WalletService } from '../wallet/wallet.service';
import type { IntegrationsConfig } from '../../config/configuration';
import { PaymentStatus, canTransitionTo, transitionPayment } from './payment-status';

@Controller()
export class XenditWebhookController {
  private readonly logger = new Logger('XenditWebhook');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly wallet: WalletService,
    private readonly config: ConfigService,
  ) {}

  @Post('webhooks/xendit')
  async handle(
    @Body() payload: Record<string, any>,
    @Headers('x-callback-token') callbackToken: string | undefined,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const expected = this.config.get<IntegrationsConfig>('integrations')!.xendit.webhookToken;
    if (!callbackToken || !expected) {
      this.logger.warn('missing callback token or config');
      throw new HttpException({ error: 'Token verification required' }, HttpStatus.BAD_REQUEST);
    }
    if (!this.constantEquals(expected, callbackToken)) {
      this.logger.warn('token verification failed');
      throw new HttpException({ error: 'Invalid token' }, HttpStatus.BAD_REQUEST);
    }

    const event: string | null = payload.event ?? null;
    const data: Record<string, any> = payload.data ?? {};
    const isFlatInvoice = !event && payload.external_id !== undefined && payload.status !== undefined;
    if (!event && !isFlatInvoice) {
      throw new HttpException({ error: 'Invalid payload' }, HttpStatus.BAD_REQUEST);
    }

    // Replay guard.
    const eventId = this.deriveEventId(req, payload, event, data);
    let eventRowId: string | null = null;
    if (eventId) {
      const existing = await this.prisma.webhookEvent.findUnique({
        where: { provider_eventId: { provider: 'xendit', eventId } },
      });
      if (existing) {
        if (existing.status === 'processed') return { status: 'ok', deduped: true };
        eventRowId = existing.id;
      } else {
        const created = await this.prisma.webhookEvent
          .create({
            data: { provider: 'xendit', eventId, eventType: event, payload: payload as Prisma.InputJsonValue, status: 'received' },
          })
          .catch(() => null);
        eventRowId = created?.id ?? null;
      }
    }

    if (event) {
      switch (event) {
        case 'payment.succeeded': await this.handlePaymentSucceeded(data); break;
        case 'payment.failed': await this.handlePaymentFailed(data); break;
        case 'payment.pending': await this.handlePaymentPending(data); break;
        case 'refund.succeeded': await this.handleRefundSucceeded(data); break;
        case 'invoice.paid': await this.handleInvoicePaid(Object.keys(data).length ? data : payload); break;
        case 'invoice.expired': await this.handleInvoiceExpired(Object.keys(data).length ? data : payload); break;
        case 'payment_method.activated': await this.handlePaymentMethodStatus(data, 'active'); break;
        case 'payment_method.expired': await this.handlePaymentMethodStatus(data, 'expired'); break;
        case 'payment_method.failed': await this.handlePaymentMethodStatus(data, 'failed'); break;
        default: break;
      }
    } else {
      const status = String(payload.status).toUpperCase();
      if (['PAID', 'SETTLED'].includes(status)) await this.handleInvoicePaid(payload);
      else if (status === 'EXPIRED') await this.handleInvoiceExpired(payload);
    }

    if (eventRowId) {
      await this.prisma.webhookEvent
        .update({ where: { id: eventRowId }, data: { status: 'processed', processedAt: new Date() } })
        .catch(() => undefined);
    }
    return { status: 'ok' };
  }

  private constantEquals(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }

  private deriveEventId(
    req: Request,
    payload: Record<string, any>,
    event: string | null,
    data: Record<string, any>,
  ): string | null {
    const headerId = req.headers['webhook-id'];
    if (headerId && typeof headerId === 'string') return `xnd:${headerId}`;
    if (event) {
      const ref =
        data.id ?? data.payment_request_id ?? data.reference_id ?? data.external_id ?? createHash('md5').update(JSON.stringify(data)).digest('hex');
      return `${event}:${ref}`;
    }
    const ref = payload.id ?? payload.external_id ?? null;
    if (ref) return `inv:${ref}:${String(payload.status ?? '').toUpperCase()}`;
    return null;
  }

  private async handleInvoicePaid(data: Record<string, any>): Promise<void> {
    const externalId: string | undefined = data.external_id;
    if (!externalId) return;
    if (externalId.startsWith('topup-')) {
      await this.wallet.completeTopUp(externalId.slice(6), data);
      return;
    }
    if (externalId.startsWith('booking-')) {
      const paymentId = externalId.slice(8);
      const changed = await this.advance(paymentId, PaymentStatus.Completed, 'invoice.paid', {
        paidAt: new Date(),
        gatewayResponse: data as Prisma.InputJsonValue,
      }, 'paid');
      if (changed) await this.notifyPayment(paymentId, 'completed');
    }
  }

  private async handleInvoiceExpired(data: Record<string, any>): Promise<void> {
    const externalId: string | undefined = data.external_id;
    if (!externalId) return;
    if (externalId.startsWith('topup-')) {
      await this.wallet.expireTopUp(externalId.slice(6), 'Invoice expired');
      return;
    }
    if (externalId.startsWith('booking-')) {
      const paymentId = externalId.slice(8);
      const changed = await this.advance(paymentId, PaymentStatus.Expired, 'invoice.expired', {
        gatewayResponse: data as Prisma.InputJsonValue,
      }, 'expired');
      if (changed) await this.notifyPayment(paymentId, 'expired');
    }
  }

  private async handlePaymentMethodStatus(data: Record<string, any>, status: string): Promise<void> {
    if (!data.id) return;
    await this.prisma.paymentMethod.updateMany({ where: { gatewayRef: data.id }, data: { status } });
  }

  private async handlePaymentSucceeded(data: Record<string, any>): Promise<void> {
    const prId = data.payment_request_id;
    if (!prId) return;
    const changed = await this.advanceByTx(prId, PaymentStatus.Completed, 'payment.succeeded', {
      paidAt: new Date(),
      gatewayResponse: data as Prisma.InputJsonValue,
    }, 'paid');
    if (changed) await this.notifyPaymentByTx(prId, 'completed');
  }

  private async handlePaymentFailed(data: Record<string, any>): Promise<void> {
    const prId = data.payment_request_id;
    if (!prId) return;
    // Reconcile the booking too (like the succeeded/expired siblings and the
    // Laravel handler) — passing null left booking.payment_status stranded at
    // 'pending' while the payment row moved to 'failed'.
    const changed = await this.advanceByTx(prId, PaymentStatus.Failed, 'payment.failed', {
      gatewayResponse: data as Prisma.InputJsonValue,
    }, 'failed');
    if (changed) await this.notifyPaymentByTx(prId, 'failed');
  }

  private async handlePaymentPending(data: Record<string, any>): Promise<void> {
    const prId = data.payment_request_id;
    if (!prId) return;
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Payment[]>(
        Prisma.sql`SELECT * FROM payments WHERE gateway_tx_id = ${prId} FOR UPDATE LIMIT 1`,
      );
      const p = rows[0];
      if (!p || p.status !== PaymentStatus.Pending) return;
      await transitionPayment(tx, p, PaymentStatus.Processing, {
        actor: 'webhook',
        reason: 'payment.pending',
        extra: { gatewayResponse: data as Prisma.InputJsonValue },
      });
    });
  }

  private async handleRefundSucceeded(data: Record<string, any>): Promise<void> {
    const referenceId: string | undefined = data.reference_id;
    if (!referenceId || !referenceId.startsWith('refund-')) return;
    const paymentId = referenceId.slice(7);
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Payment[]>(
        Prisma.sql`SELECT * FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE LIMIT 1`,
      );
      const p = rows[0];
      if (!p || p.status === PaymentStatus.Refunded) return;
      if (p.status !== PaymentStatus.Completed) {
        this.logger.warn(`refund.succeeded for non-completed payment ${p.id} (${p.status}); ignoring`);
        return;
      }
      await transitionPayment(tx, p, PaymentStatus.Refunded, {
        actor: 'webhook',
        reason: 'refund.succeeded',
        extra: {
          refundAmount: new Prisma.Decimal(data.amount ?? p.amount),
          refundedAt: new Date(),
          gatewayResponse: data as Prisma.InputJsonValue,
        },
      });
    });
  }

  /** Advance a payment (by id) if the transition is legal; optionally set booking.payment_status. */
  private async advance(
    paymentId: string,
    to: PaymentStatus,
    reason: string,
    extra: Prisma.PaymentUpdateInput,
    bookingStatus: string | null,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Payment[]>(
        Prisma.sql`SELECT * FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE LIMIT 1`,
      );
      const p = rows[0];
      if (!p || !canTransitionTo(p.status, to)) return false;
      await transitionPayment(tx, p, to, { actor: 'webhook', reason, extra });
      if (bookingStatus && p.bookingId) {
        await tx.booking.update({ where: { id: p.bookingId }, data: { paymentStatus: bookingStatus } });
      }
      return true;
    });
  }

  /** Same as advance() but keyed by gateway_tx_id (payment_request_id). */
  private async advanceByTx(
    prId: string,
    to: PaymentStatus,
    reason: string,
    extra: Prisma.PaymentUpdateInput,
    bookingStatus: string | null,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Payment[]>(
        Prisma.sql`SELECT * FROM payments WHERE gateway_tx_id = ${prId} FOR UPDATE LIMIT 1`,
      );
      const p = rows[0];
      if (!p || !canTransitionTo(p.status, to)) return false;
      await transitionPayment(tx, p, to, { actor: 'webhook', reason, extra });
      if (bookingStatus && p.bookingId) {
        await tx.booking.update({ where: { id: p.bookingId }, data: { paymentStatus: bookingStatus } });
      }
      return true;
    });
  }

  private async notifyPayment(paymentId: string, status: 'completed' | 'failed' | 'expired'): Promise<void> {
    const p = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { select: { bookingNumber: true } } },
    });
    if (p) await this.pushPayment(p, p.booking?.bookingNumber ?? null, status);
  }

  private async notifyPaymentByTx(prId: string, status: 'completed' | 'failed' | 'expired'): Promise<void> {
    const p = await this.prisma.payment.findFirst({
      where: { gatewayTxId: prId },
      include: { booking: { select: { bookingNumber: true } } },
    });
    if (p) await this.pushPayment(p, p.booking?.bookingNumber ?? null, status);
  }

  private async pushPayment(
    payment: Payment,
    bookingNo: string | null,
    status: 'completed' | 'failed' | 'expired',
  ): Promise<void> {
    const amount = Number(payment.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const forBooking = bookingNo ? ` for booking ${bookingNo}` : '';
    const map = {
      completed: ['Payment confirmed', `Your ₱${amount} payment${forBooking} is confirmed.`],
      expired: ['Payment expired', `Your payment window${forBooking} expired. You weren't charged — you can try again.`],
      failed: ['Payment failed', `We couldn't confirm your ₱${amount} payment${forBooking}. You weren't charged — try again or use another method.`],
    } as const;
    const [title, body] = map[status];
    await this.notifications.sendPush(payment.customerId, title, body, {
      type: 'payment',
      status,
      booking_id: payment.bookingId,
      payment_id: payment.id,
    });
  }
}
