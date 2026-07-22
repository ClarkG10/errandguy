import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Payment, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { XenditService } from '../../integrations/xendit.service';
import { WalletService } from '../wallet/wallet.service';
import { PaymentGatewayException } from '../../common/exceptions/payment-gateway.exception';
import type { AppConfig } from '../../config/configuration';
import { PaymentStatus, transitionPayment } from './payment-status';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger('Payment');

  constructor(
    private readonly prisma: PrismaService,
    private readonly xendit: XenditService,
    private readonly wallet: WalletService,
    private readonly config: ConfigService,
  ) {}

  private appUrl(): string {
    return this.config.get<AppConfig>('app')!.url.replace(/\/+$/, '');
  }

  /** Wrap a Xendit call, turning gateway errors into PaymentGatewayException. */
  private async gateway<T>(fn: () => Promise<T>, failMsg: string): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const body = (e as { response?: { data?: { message?: string; error_code?: string } } }).response?.data;
      this.logger.error(`${failMsg} ${JSON.stringify(body ?? (e as Error).message)}`);
      throw new PaymentGatewayException(failMsg, body?.message ?? null, body?.error_code ?? null);
    }
  }

  private mapMethod(method: string): string {
    switch (method) {
      case 'gcash':
      case 'maya':
      case 'grab_pay':
        return 'EWALLET';
      case 'card':
        return 'CARD';
      default:
        return 'EWALLET';
    }
  }

  async createPaymentRequest(
    amount: number,
    referenceId: string,
    method: string,
    description = '',
    successRedirectUrl?: string,
    failureRedirectUrl?: string,
  ): Promise<any> {
    const paymentMethod: Record<string, unknown> = {
      type: this.mapMethod(method),
      reusability: 'ONE_TIME_USE',
    };
    if (method === 'gcash' || method === 'maya') {
      paymentMethod.ewallet = {
        channel_code: method === 'gcash' ? 'GCASH' : 'PAYMAYA',
        channel_properties: {
          success_return_url: successRedirectUrl ?? `${this.appUrl()}/payment/success`,
          failure_return_url: failureRedirectUrl ?? `${this.appUrl()}/payment/failed`,
        },
      };
    }
    return this.gateway(
      () =>
        this.xendit.request(
          'POST',
          '/payment_requests',
          {
            reference_id: referenceId,
            amount: Math.round(amount * 100) / 100,
            currency: 'PHP',
            description,
            payment_method: paymentMethod,
          },
          { 'Idempotency-key': `pr-${referenceId}` },
        ),
      'Failed to create payment request.',
    );
  }

  async createInvoice(
    amount: number,
    externalId: string,
    description = '',
    payerEmail = '',
    successRedirectUrl?: string,
  ): Promise<any> {
    if (!this.config.get<{ xendit: { secretKey: string } }>('integrations')!.xendit.secretKey) {
      throw new PaymentGatewayException('Failed to create invoice.', 'XENDIT_SECRET_KEY is empty.', 'NOT_CONFIGURED');
    }
    return this.gateway(
      () =>
        this.xendit.createInvoice({
          amount,
          externalId,
          description,
          payerEmail: payerEmail || undefined,
          successRedirectUrl,
          idempotencyKey: `inv-${externalId}`,
        }),
      'Failed to create invoice.',
    );
  }

  async getOrCreateXenditCustomer(user: User): Promise<string> {
    if (user.xenditCustomerId) return user.xenditCustomerId;
    const res = await this.gateway(
      () =>
        this.xendit.createCustomer({
          reference_id: `user-${user.id}`,
          type: 'INDIVIDUAL',
          individual_detail: { given_names: user.fullName || 'ErrandGuy Customer' },
          email: user.email || null,
        }),
      'Failed to set up your payment profile.',
    );
    const customerId = String(res.id);
    await this.prisma.user.update({ where: { id: user.id }, data: { xenditCustomerId: customerId } });
    return customerId;
  }

  async createLinkedEwallet(
    user: User,
    channelCode: string,
    successUrl: string,
    failureUrl: string,
  ): Promise<any> {
    const customerId = await this.getOrCreateXenditCustomer(user);
    return this.gateway(
      () =>
        this.xendit.createPaymentMethod({
          type: 'EWALLET',
          reusability: 'MULTIPLE_USE',
          customer_id: customerId,
          ewallet: {
            channel_code: channelCode,
            channel_properties: { success_return_url: successUrl, failure_return_url: failureUrl },
          },
        }),
      'Failed to link this payment method.',
    );
  }

  async chargeSavedMethod(
    xenditPaymentMethodId: string,
    amount: number,
    referenceId: string,
    description = '',
  ): Promise<any> {
    return this.gateway(
      () =>
        this.xendit.createPaymentRequest(
          {
            reference_id: referenceId,
            currency: 'PHP',
            amount: Math.round(amount * 100) / 100,
            payment_method_id: xenditPaymentMethodId,
            description,
          },
          `pr-${referenceId}`,
        ),
      'Failed to charge your saved payment method.',
    );
  }

  static extractActionUrl(data: any): string | null {
    for (const action of data?.actions ?? []) {
      const url = action?.url ?? action?.value ?? null;
      if (url) return url;
    }
    return null;
  }

  async getPaymentRequest(paymentRequestId: string): Promise<any> {
    return this.gateway(
      () => this.xendit.request('GET', `/payment_requests/${paymentRequestId}`),
      'Failed to retrieve payment request.',
    );
  }

  async refundPayment(paymentId: string, amount?: number, reason = 'REQUESTED_BY_CUSTOMER'): Promise<any> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const refundAmount = amount ?? Number(payment.amount);
    const res = await this.gateway(
      () =>
        this.xendit.request(
          'POST',
          '/refunds',
          {
            payment_request_id: payment.gatewayTxId,
            amount: Math.round(refundAmount * 100) / 100,
            currency: 'PHP',
            reason,
            reference_id: `refund-${payment.id}`,
          },
          { 'Idempotency-key': `rf-${payment.id}` },
        ),
      'Failed to process refund.',
    );
    await transitionPayment(this.prisma, payment, PaymentStatus.Refunded, {
      actor: 'system',
      reason,
      meta: { refund_amount: refundAmount },
      extra: { refundAmount: new Prisma.Decimal(refundAmount), refundedAt: new Date() },
    });
    return res;
  }

  /** Create + settle a booking payment (cash pending, wallet immediate, online → gateway). */
  async processBookingPayment(
    bookingId: string,
    customerId: string,
    amount: number,
    method: string,
  ): Promise<Payment> {
    const payment = await this.prisma.payment.create({
      data: {
        bookingId,
        customerId,
        amount: new Prisma.Decimal(amount),
        currency: 'PHP',
        method,
        status: 'pending',
      },
    });

    if (method === 'cash') return payment;

    if (method === 'wallet') {
      await this.wallet.deduct(customerId, amount, payment.id, `Payment for booking ${bookingId}`);
      await transitionPayment(this.prisma, payment, PaymentStatus.Completed, { extra: { paidAt: new Date() } });
      return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    }

    try {
      const pr = await this.createPaymentRequest(amount, `booking-${bookingId}`, method, `Booking ${bookingId}`);
      await transitionPayment(this.prisma, payment, PaymentStatus.Processing, {
        extra: { gatewayTxId: pr.id, gatewayResponse: pr as Prisma.InputJsonValue },
      });
    } catch (e) {
      this.logger.error(`Payment processing failed for booking ${bookingId}: ${(e as Error).message}`);
      await transitionPayment(this.prisma, payment, PaymentStatus.Failed, { reason: 'Gateway charge failed' });
    }
    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }
}
