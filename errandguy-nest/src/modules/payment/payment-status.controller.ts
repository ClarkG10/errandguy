import { Controller, Get, HttpException, HttpStatus, Param, UseGuards } from '@nestjs/common';
import type { Booking, Payment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { iso } from '../../common/serialization';

type PaymentWithBooking = Payment & {
  booking?: Pick<Booking, 'id' | 'bookingNumber' | 'paymentStatus'> | null;
};

/** Authoritative status probe the app polls to verify a payment. */
@Controller()
@UseGuards(SanctumAuthGuard, ActiveGuard)
export class PaymentStatusController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('payments/:id/status')
  async show(@CurrentUser() user: { id: string }, @Param('id') id: string): Promise<{ data: unknown }> {
    const payment = await this.prisma.payment.findFirst({
      where: { id, customerId: user.id },
      include: { booking: { select: { id: true, bookingNumber: true, paymentStatus: true } } },
    });
    if (!payment) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    return { data: this.present(payment) };
  }

  @Get('bookings/:id/payment-status')
  async forBooking(
    @CurrentUser() user: { id: string },
    @Param('id') bookingId: string,
  ): Promise<{ data: unknown }> {
    const payment = await this.prisma.payment.findFirst({
      where: { bookingId, customerId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { booking: { select: { id: true, bookingNumber: true, paymentStatus: true } } },
    });
    if (!payment) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    return { data: this.present(payment) };
  }

  private present(payment: PaymentWithBooking): Record<string, unknown> {
    const gr = (payment.gatewayResponse ?? {}) as Record<string, unknown>;
    const failureReason = gr.failure_code ?? gr.failure_reason ?? gr.status ?? null;
    return {
      payment_id: payment.id,
      status: payment.status,
      booking_id: payment.bookingId,
      booking_payment_status: payment.booking?.paymentStatus ?? null,
      amount: Number(payment.amount),
      method: payment.method,
      reference: payment.gatewayTxId ?? payment.booking?.bookingNumber ?? null,
      paid_at: iso(payment.paidAt),
      failure_reason: ['failed', 'expired'].includes(payment.status) ? failureReason : null,
    };
  }
}
