import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  newPdfDocument,
  renderEarningsPdf,
  renderReceiptPdf,
  type EarningsPdfData,
  type ReceiptPdfData,
} from './export.pdf';

/** UTC start-of-day for the given instant (app timezone is UTC). */
function startOfDayUtc(base: Date): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 0, 0, 0, 0));
}

function addDaysUtc(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}

/** Parse a "YYYY-MM-DD" (or datetime with a date prefix) and zero to start/end of day. */
function parseDayBound(value: string, endOfDay: boolean): Date | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return endOfDay
    ? new Date(Date.UTC(y, mo, d, 23, 59, 59, 999))
    : new Date(Date.UTC(y, mo, d, 0, 0, 0, 0));
}

interface PeriodResult {
  completedAt: Prisma.DateTimeNullableFilter | undefined;
  rangeStart: Date | null;
  rangeEnd: Date | null;
}

/**
 * Reproduces ExportController::applyPeriod — the same completed_at bounds the
 * runner earnings summary uses, plus the [start, end] shown on the statement.
 */
function resolvePeriod(
  period: string,
  dateFrom: string | undefined,
  dateTo: string | undefined,
): PeriodResult {
  const now = new Date();
  switch (period) {
    case 'today': {
      const start = startOfDayUtc(now);
      const end = addDaysUtc(start, 1);
      return { completedAt: { gte: start, lt: end }, rangeStart: start, rangeEnd: now };
    }
    case 'this_week': {
      const dow = now.getUTCDay(); // 0=Sun..6=Sat
      const sinceMonday = (dow + 6) % 7;
      const start = startOfDayUtc(addDaysUtc(now, -sinceMonday));
      const sunday = addDaysUtc(start, 6);
      const end = new Date(Date.UTC(sunday.getUTCFullYear(), sunday.getUTCMonth(), sunday.getUTCDate(), 23, 59, 59, 999));
      return { completedAt: { gte: start, lte: end }, rangeStart: start, rangeEnd: end };
    }
    case 'this_month': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
      return { completedAt: { gte: start, lt: end }, rangeStart: start, rangeEnd: now };
    }
    case 'custom': {
      const start = dateFrom ? parseDayBound(dateFrom, false) : null;
      const end = dateTo ? parseDayBound(dateTo, true) : null;
      const filter: Prisma.DateTimeNullableFilter = {};
      if (start) filter.gte = start;
      if (end) filter.lte = end;
      const completedAt = start || end ? filter : undefined;
      return { completedAt, rangeStart: start, rangeEnd: end };
    }
    default:
      return { completedAt: undefined, rangeStart: null, rangeEnd: null };
  }
}

/** `$request->filled(key)` — present and not an empty string. */
function filled(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value);
  return s.length > 0 ? s : undefined;
}

/**
 * GET /runner/earnings/export — printable runner earnings statement PDF.
 * Mirrors ExportController::earningsPdf.
 */
@Controller('runner')
@UseGuards(SanctumAuthGuard, ActiveGuard, RolesGuard)
@Roles('runner')
export class RunnerEarningsExportController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('earnings/export')
  async earningsPdf(
    @CurrentUser() user: User,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    // Ensure a runner profile exists (side-effect parity with Laravel).
    const profile = await this.prisma.runnerProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      await this.prisma.runnerProfile.create({
        data: { userId: user.id, verificationStatus: 'pending' },
      });
    }

    const period = filled(query.period) ?? 'today';
    const dateFrom = filled(query.date_from);
    const dateTo = filled(query.date_to);
    const { completedAt, rangeStart, rangeEnd } = resolvePeriod(period, dateFrom, dateTo);

    const where: Prisma.BookingWhereInput = { runnerId: user.id, status: 'completed' };
    if (completedAt) where.completedAt = completedAt;

    const agg = await this.prisma.booking.aggregate({
      where,
      _sum: { runnerPayout: true },
      _count: true,
    });
    const totalEarnings = Number(agg._sum.runnerPayout ?? 0);
    const totalErrands = agg._count;
    const avgPerErrand = totalErrands > 0
      ? Math.round((totalEarnings / totalErrands) * 100) / 100
      : 0;

    const lineItems = await this.prisma.booking.findMany({
      where,
      include: { errandType: { select: { id: true, name: true } } },
      orderBy: { completedAt: 'desc' },
      take: 500,
    });

    const data: EarningsPdfData = {
      runner: { name: user.fullName, phone: user.phone },
      period,
      range_start: rangeStart,
      range_end: rangeEnd,
      total_earnings: totalEarnings,
      total_errands: totalErrands,
      avg_per_errand: avgPerErrand,
      line_items: lineItems.map((b) => ({
        completed_at: b.completedAt,
        booking_number: b.bookingNumber,
        errand_type: b.errandType?.name ?? null,
        runner_payout: b.runnerPayout,
      })),
      generated_at: new Date(),
    };

    const doc = newPdfDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="earnings.pdf"');
    doc.pipe(res);
    renderEarningsPdf(doc, data);
    doc.end();
  }
}

/**
 * GET /payments/{id}/receipt/pdf — printable receipt PDF for a payment the
 * caller owns. Mirrors ExportController::receiptPdf.
 */
@Controller('payments')
@UseGuards(SanctumAuthGuard, ActiveGuard)
export class PaymentReceiptPdfController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/receipt/pdf')
  async receiptPdf(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { id, customerId: user.id },
      include: { booking: { include: { errandType: true, runner: true } } },
    });
    if (!payment) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);

    const b = payment.booking;
    const data: ReceiptPdfData = {
      payment: {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        paid_at: payment.paidAt,
        refund_amount: payment.refundAmount,
        refunded_at: payment.refundedAt,
      },
      booking: {
        booking_number: b?.bookingNumber ?? null,
        errand_type: b?.errandType?.name ?? null,
        pickup_address: b?.pickupAddress ?? null,
        dropoff_address: b?.dropoffAddress ?? null,
        runner_name: b?.runner?.fullName ?? null,
      },
      generated_at: new Date(),
    };

    const doc = newPdfDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="receipt.pdf"');
    doc.pipe(res);
    renderReceiptPdf(doc, data);
    doc.end();
  }
}
