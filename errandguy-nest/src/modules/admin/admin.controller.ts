import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Prisma, WalletTransaction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { NotificationService } from '../../messaging/notification.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { CurrentAdmin } from '../../common/auth/current-user.decorator';
import { pageParams } from '../../common/pagination';
import { PaymentMethodCatalog } from '../payment/payment-method-catalog';
import { bookingResource, BOOKING_FULL_INCLUDE } from '../booking/booking.resource';
import { adminUserRow, disputeRow, runnerDocumentRow, runnerProfileRow, walletTxRow } from './admin.serializers';
import { ReasonDto, ResolveDisputeDto, SetPaymentMethodsDto } from './admin.dto';

@Controller('admin')
@UseGuards(SanctumAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly notifications: NotificationService,
    private readonly catalog: PaymentMethodCatalog,
  ) {}

  /** Laravel LengthAwarePaginator flat JSON shape (admin endpoints use response()->json($paginator)). */
  private rawPaginate(data: unknown[], total: number, page: number, perPage: number): Record<string, unknown> {
    const lastPage = Math.max(1, Math.ceil(total / perPage));
    const from = total === 0 ? null : (page - 1) * perPage + 1;
    const to = total === 0 ? null : Math.min(page * perPage, total);
    return {
      current_page: page,
      data,
      first_page_url: `?page=1`,
      from,
      last_page: lastPage,
      last_page_url: `?page=${lastPage}`,
      next_page_url: page < lastPage ? `?page=${page + 1}` : null,
      path: '',
      per_page: perPage,
      prev_page_url: page > 1 ? `?page=${page - 1}` : null,
      to,
      total,
    };
  }

  // ── dashboard ──
  @Get('dashboard/stats')
  async stats(): Promise<{ data: unknown }> {
    const data = await this.cache.remember(
      'admin:dashboard:stats',
      async () => {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const [customers, runners, activeToday, online, pendingVer, total, today, active, completedToday, disputesActive, disputesEscalated] =
          await this.prisma.$transaction([
            this.prisma.user.count({ where: { role: 'customer' } }),
            this.prisma.user.count({ where: { role: 'runner' } }),
            this.prisma.user.count({ where: { lastActiveAt: { gte: startOfDay } } }),
            this.prisma.runnerProfile.count({ where: { isOnline: true } }),
            this.prisma.runnerProfile.count({ where: { verificationStatus: 'pending' } }),
            this.prisma.booking.count(),
            this.prisma.booking.count({ where: { createdAt: { gte: startOfDay } } }),
            this.prisma.booking.count({ where: { status: { notIn: ['completed', 'cancelled'] } } }),
            this.prisma.booking.count({ where: { status: 'completed', completedAt: { gte: startOfDay } } }),
            this.prisma.disputeTicket.count({ where: { status: 'active' } }),
            this.prisma.disputeTicket.count({ where: { status: 'escalated' } }),
          ]);
        return {
          users: { total_customers: customers, total_runners: runners, active_today: activeToday },
          runners: { online, pending_verification: pendingVer },
          bookings: { total, today, active, completed_today: completedToday },
          disputes: { active: disputesActive, escalated: disputesEscalated },
        };
      },
      60,
    );
    return { data };
  }

  // ── users ──
  @Get('users')
  async users(@Query() q: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { page, perPage } = pageParams(q, 20);
    const where: Prisma.UserWhereInput = {};
    if (q.role) where.role = String(q.role);
    if (q.search) {
      const s = String(q.search);
      where.OR = [
        { fullName: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
      ];
    }
    if (q.status === 'suspended') where.status = 'suspended';
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
    ]);
    return this.rawPaginate(rows.map(adminUserRow), total, page, perPage);
  }

  @Get('users/:id')
  async userShow(@Param('id') id: string): Promise<{ data: unknown }> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { runnerProfile: { include: { documents: true } } } });
    if (!user) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    return { data: { ...adminUserRow(user), runner_profile: user.runnerProfile ? runnerProfileRow(user.runnerProfile) : null } };
  }

  @Post('users/:id/suspend')
  @HttpCode(HttpStatus.OK)
  async suspend(@Param('id') id: string, @Body() _dto: ReasonDto): Promise<{ message: string }> {
    await this.mustFindUser(id);
    await this.prisma.user.update({ where: { id }, data: { status: 'suspended' } });
    return { message: 'User suspended' };
  }

  @Post('users/:id/unsuspend')
  @HttpCode(HttpStatus.OK)
  async unsuspend(@Param('id') id: string): Promise<{ message: string }> {
    await this.mustFindUser(id);
    await this.prisma.user.update({ where: { id }, data: { status: 'active' } });
    return { message: 'User reactivated' };
  }

  private async mustFindUser(id: string): Promise<void> {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!u) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
  }

  // ── runner verification ──
  @Get('runners/pending')
  async runnersPending(@Query() q: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { page, perPage } = pageParams(q, 20);
    const where = { verificationStatus: 'pending' };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.runnerProfile.count({ where }),
      this.prisma.runnerProfile.findMany({ where, include: { user: true, documents: true }, orderBy: { createdAt: 'asc' }, skip: (page - 1) * perPage, take: perPage }),
    ]);
    return this.rawPaginate(rows.map(runnerProfileRow), total, page, perPage);
  }

  @Get('runners/:userId/documents')
  async runnerDocuments(@Param('userId') userId: string): Promise<{ data: unknown }> {
    const profile = await this.prisma.runnerProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) return { data: [] };
    const docs = await this.prisma.runnerDocument.findMany({ where: { runnerId: profile.id }, orderBy: { createdAt: 'desc' } });
    return { data: docs.map(runnerDocumentRow) };
  }

  @Post('runners/:userId/approve')
  @HttpCode(HttpStatus.OK)
  async approveRunner(@Param('userId') userId: string): Promise<{ message: string }> {
    const profile = await this.prisma.runnerProfile.findUnique({ where: { userId } });
    if (!profile) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    await this.prisma.runnerProfile.update({ where: { id: profile.id }, data: { verificationStatus: 'approved', approvedAt: new Date() } });
    await this.prisma.runnerDocument.updateMany({ where: { runnerId: profile.id, status: 'pending' }, data: { status: 'approved', reviewedAt: new Date() } });
    await this.notifications.sendPush(userId, 'Verification Approved!', 'Your runner account has been approved. You can now go online and start accepting errands.', { type: 'document_update' });
    return { message: 'Runner approved' };
  }

  @Post('runners/:userId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectRunner(@Param('userId') userId: string, @Body() dto: ReasonDto): Promise<{ message: string }> {
    const profile = await this.prisma.runnerProfile.findUnique({ where: { userId } });
    if (!profile) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    await this.prisma.runnerProfile.update({ where: { id: profile.id }, data: { verificationStatus: 'rejected' } });
    await this.prisma.runnerDocument.updateMany({ where: { runnerId: profile.id, status: 'pending' }, data: { status: 'rejected', rejectionReason: dto.reason, reviewedAt: new Date() } });
    await this.notifications.sendPush(userId, 'Verification Update', 'Your runner verification was not approved. Please check the details and resubmit.', { type: 'document_update' });
    return { message: 'Runner rejected' };
  }

  // ── bookings ──
  @Get('bookings')
  async bookings(@Query() q: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { page, perPage } = pageParams(q, 20);
    const where: Prisma.BookingWhereInput = {};
    if (q.status) where.status = String(q.status);
    if (q.search) {
      const s = String(q.search);
      where.OR = [{ bookingNumber: { contains: s, mode: 'insensitive' } }, { customer: { fullName: { contains: s, mode: 'insensitive' } } }];
    }
    if (q.date) {
      const start = new Date(`${String(q.date)}T00:00:00`);
      const end = new Date(`${String(q.date)}T23:59:59.999`);
      where.createdAt = { gte: start, lte: end };
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.booking.count({ where }),
      this.prisma.booking.findMany({ where, include: { customer: true, runner: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
    ]);
    return this.rawPaginate(rows.map((b) => bookingResource(b, undefined, true)), total, page, perPage);
  }

  @Get('bookings/:id')
  async bookingShow(@Param('id') id: string): Promise<{ data: unknown }> {
    const b = await this.prisma.booking.findUnique({ where: { id }, include: BOOKING_FULL_INCLUDE });
    if (!b) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    return { data: bookingResource(b, undefined, true) };
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async bookingCancel(@Param('id') id: string, @Body() dto: ReasonDto): Promise<{ message: string }> {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    if (['completed', 'cancelled'].includes(booking.status)) {
      throw new HttpException({ message: 'Booking already finalized' }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    // cancelled_by is a uuid FK to users; an admin is not a user row → leave null and record intent in the reason.
    await this.prisma.booking.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: null, cancellationReason: dto.reason },
    });
    await this.prisma.bookingStatusLog.create({ data: { bookingId: id, status: 'cancelled', changedBy: null, note: `Cancelled by admin: ${dto.reason}` } });
    return { message: 'Booking cancelled by admin' };
  }

  // ── disputes ──
  @Get('disputes')
  async disputes(@Query() q: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { page, perPage } = pageParams(q, 20);
    const where: Prisma.DisputeTicketWhereInput = {};
    if (q.status) where.status = String(q.status);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.disputeTicket.count({ where }),
      this.prisma.disputeTicket.findMany({ where, include: { booking: true, reporter: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
    ]);
    return this.rawPaginate(rows.map(disputeRow), total, page, perPage);
  }

  @Get('disputes/:id')
  async disputeShow(@Param('id') id: string): Promise<{ data: unknown }> {
    const d = await this.prisma.disputeTicket.findUnique({
      where: { id },
      include: { booking: { include: { customer: true, runner: true } }, reporter: true },
    });
    if (!d) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    const base = disputeRow(d);
    if (d.booking) {
      base.booking = {
        id: d.booking.id,
        booking_number: d.booking.bookingNumber,
        customer: d.booking.customer ? { id: d.booking.customer.id, full_name: d.booking.customer.fullName, email: d.booking.customer.email, phone: d.booking.customer.phone } : null,
        runner: d.booking.runner ? { id: d.booking.runner.id, full_name: d.booking.runner.fullName, email: d.booking.runner.email, phone: d.booking.runner.phone } : null,
      };
    }
    return { data: base };
  }

  @Post('disputes/:id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolveDispute(@Param('id') id: string, @Body() dto: ResolveDisputeDto): Promise<{ message: string }> {
    const dispute = await this.prisma.disputeTicket.findUnique({ where: { id } });
    if (!dispute) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    await this.prisma.disputeTicket.update({ where: { id }, data: { status: 'resolved', resolution: dto.resolution_note, resolvedAt: new Date() } });
    await this.notifications.sendPush(dispute.reportedBy, 'Dispute Resolved', 'Your dispute has been reviewed and resolved. Check the details for more info.', { type: 'system' });
    return { message: 'Dispute resolved' };
  }

  @Post('disputes/:id/escalate')
  @HttpCode(HttpStatus.OK)
  async escalateDispute(@Param('id') id: string): Promise<{ message: string }> {
    const dispute = await this.prisma.disputeTicket.findUnique({ where: { id }, select: { id: true } });
    if (!dispute) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    await this.prisma.disputeTicket.update({ where: { id }, data: { status: 'escalated' } });
    return { message: 'Dispute escalated' };
  }

  // ── payouts ──
  @Get('payouts')
  async payouts(@Query() q: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { page, perPage } = pageParams(q, 25);
    const where: Prisma.WalletTransactionWhereInput = { type: 'payout' };
    if (q.status) where.status = String(q.status);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.walletTransaction.count({ where }),
      this.prisma.walletTransaction.findMany({ where, include: { user: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
    ]);
    return this.rawPaginate(rows.map(walletTxRow), total, page, perPage);
  }

  @Post('payouts/:id/complete')
  @HttpCode(HttpStatus.OK)
  async payoutComplete(@Param('id') id: string): Promise<{ data: unknown }> {
    const tx = await this.prisma.walletTransaction.findFirst({ where: { id, type: 'payout' } });
    if (!tx) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    if (tx.status !== 'pending') throw new HttpException({ message: 'Only pending payouts can be marked completed.' }, HttpStatus.UNPROCESSABLE_ENTITY);
    const updated = await this.prisma.walletTransaction.update({ where: { id }, data: { status: 'completed', processedAt: new Date() } });
    return { data: walletTxRow(updated) };
  }

  @Post('payouts/:id/fail')
  @HttpCode(HttpStatus.OK)
  async payoutFail(@Param('id') id: string, @Body() dto: ReasonDto): Promise<{ data: unknown }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<WalletTransaction[]>(
        Prisma.sql`SELECT * FROM wallet_transactions WHERE id = ${id}::uuid AND type = 'payout' FOR UPDATE LIMIT 1`,
      );
      const payout = rows[0];
      if (!payout) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
      if (payout.status !== 'pending') throw new HttpException({ message: 'Only pending payouts can be processed.' }, HttpStatus.UNPROCESSABLE_ENTITY);

      const userRows = await tx.$queryRaw<{ wallet_balance: Prisma.Decimal }[]>(
        Prisma.sql`SELECT wallet_balance FROM users WHERE id = ${payout.userId}::uuid FOR UPDATE LIMIT 1`,
      );
      if (!userRows[0]) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
      const refundAmount = Math.abs(Number(payout.amount));
      const newBalance = Number(userRows[0].wallet_balance) + refundAmount;

      await tx.walletTransaction.create({
        data: {
          userId: payout.userId,
          type: 'refund',
          amount: new Prisma.Decimal(refundAmount),
          balanceAfter: new Prisma.Decimal(newBalance),
          referenceId: payout.id,
          description: 'Refund for failed payout',
          status: 'completed',
          processedAt: new Date(),
        },
      });
      await tx.user.update({ where: { id: payout.userId }, data: { walletBalance: new Prisma.Decimal(newBalance) } });
      return tx.walletTransaction.update({ where: { id }, data: { status: 'failed', processedAt: new Date(), failureReason: dto.reason } });
    });
    return { data: walletTxRow(result) };
  }

  // ── payment settings ──
  @Get('payment-methods')
  async paymentMethods(): Promise<{ data: unknown }> {
    return { data: await this.catalog.catalogWithState() };
  }

  @Put('payment-methods')
  @HttpCode(HttpStatus.OK)
  async setPaymentMethods(@CurrentAdmin() admin: { id: string }, @Body() dto: SetPaymentMethodsDto): Promise<Record<string, unknown>> {
    const enabled = await this.catalog.setEnabled(dto.methods, admin.id);
    return { data: await this.catalog.catalogWithState(), enabled, message: 'Available payment methods updated.' };
  }
}
