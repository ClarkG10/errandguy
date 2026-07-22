import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { paginate, pageParams } from '../../common/pagination';
import type { AppConfig } from '../../config/configuration';
import { bookingResource } from '../booking/booking.resource';

@Controller('runner')
@UseGuards(SanctumAuthGuard, ActiveGuard, RolesGuard)
@Roles('runner')
export class RunnerEarningsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private path(suffix: string): string {
    const app = this.config.get<AppConfig>('app')!;
    return `${app.url.replace(/\/+$/, '')}/${app.apiPrefix}/runner/${suffix}`;
  }

  @Get('earnings')
  async summary(@CurrentUser() user: User, @Query() query: Record<string, unknown>): Promise<Record<string, unknown>> {
    let profile = await this.prisma.runnerProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      profile = await this.prisma.runnerProfile.create({ data: { userId: user.id, verificationStatus: 'pending' } });
    }

    const period = query.period ? String(query.period) : 'today';
    const where: Prisma.BookingWhereInput = { runnerId: user.id, status: 'completed' };
    const range = this.periodRange(period, query);
    if (range) where.completedAt = range;

    const agg = await this.prisma.booking.aggregate({ where, _sum: { runnerPayout: true }, _count: true });
    const totalEarnings = Number(agg._sum.runnerPayout ?? 0);
    const totalErrands = agg._count;
    const avgPerErrand = totalErrands > 0 ? Math.round((totalEarnings / totalErrands) * 100) / 100 : 0;

    return {
      data: {
        period,
        total_earnings: totalEarnings,
        total_errands: totalErrands,
        avg_per_errand: avgPerErrand,
        acceptance_rate: Number(profile.acceptanceRate),
        completion_rate: Number(profile.completionRate),
        online_hours: null,
      },
    };
  }

  @Get('earnings/history')
  async history(@CurrentUser() user: User, @Query() query: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { page, perPage } = pageParams(query, 15);
    const where: Prisma.BookingWhereInput = { runnerId: user.id, status: 'completed' };
    if (query.errand_type_id) where.errandTypeId = String(query.errand_type_id);
    if (query.date_from || query.date_to) {
      where.completedAt = {
        ...(query.date_from ? { gte: new Date(`${String(query.date_from)}T00:00:00`) } : {}),
        ...(query.date_to ? { lte: new Date(`${String(query.date_to)}T23:59:59.999`) } : {}),
      };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.booking.count({ where }),
      this.prisma.booking.findMany({
        where,
        include: { errandType: true, customer: true },
        orderBy: { completedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    return paginate(rows.map((b) => bookingResource(b, user.id)), total, page, perPage, this.path('earnings/history'));
  }

  @Get('errands/history')
  async errands(@CurrentUser() user: User, @Query() query: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { page, perPage } = pageParams(query, 15);
    const where: Prisma.BookingWhereInput = { runnerId: user.id, status: { in: ['completed', 'cancelled'] } };
    if (query.status) where.status = { in: ['completed', 'cancelled'], equals: String(query.status) };
    if (query.errand_type_id) where.errandTypeId = String(query.errand_type_id);
    if (query.date_from || query.date_to) {
      where.createdAt = {
        ...(query.date_from ? { gte: new Date(`${String(query.date_from)}T00:00:00`) } : {}),
        ...(query.date_to ? { lte: new Date(`${String(query.date_to)}T23:59:59.999`) } : {}),
      };
    }
    if (query.search) {
      const search = String(query.search);
      where.OR = [
        { bookingNumber: { contains: search, mode: 'insensitive' } },
        { customer: { fullName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.booking.count({ where }),
      this.prisma.booking.findMany({
        where,
        include: { errandType: true, customer: true, reviews: { include: { reviewer: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    const data = rows.map(({ reviews, ...b }) => bookingResource({ ...b, review: reviews[0] ?? null }, user.id));
    return paginate(data, total, page, perPage, this.path('errands/history'));
  }

  /** Reproduce the EarningsController period windows (UTC, matching Carbon). */
  private periodRange(period: string, query: Record<string, unknown>): Prisma.DateTimeNullableFilter | null {
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (period === 'today') {
      return { gte: startOfDay, lt: new Date(startOfDay.getTime() + 86_400_000) };
    }
    if (period === 'this_week') {
      const daysSinceMonday = (startOfDay.getUTCDay() + 6) % 7;
      const weekStart = new Date(startOfDay.getTime() - daysSinceMonday * 86_400_000);
      const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000 - 1);
      return { gte: weekStart, lte: weekEnd };
    }
    if (period === 'this_month') {
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      return { gte: monthStart, lt: nextMonth };
    }
    if (period === 'custom') {
      const range: Prisma.DateTimeNullableFilter = {};
      if (query.date_from) range.gte = new Date(`${String(query.date_from)}T00:00:00`);
      if (query.date_to) range.lte = new Date(`${String(query.date_to)}T23:59:59.999`);
      return Object.keys(range).length ? range : null;
    }
    return null;
  }
}
