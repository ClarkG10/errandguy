import { Controller, Get, HttpException, HttpStatus, Param, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { paginate, pageParams } from '../../common/pagination';
import { iso } from '../../common/serialization';
import type { AppConfig } from '../../config/configuration';
import { paymentResource } from './payment.resource';

@Controller('payments')
@UseGuards(SanctumAuthGuard, ActiveGuard)
export class PaymentHistoryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get('history')
  async index(
    @CurrentUser() user: User,
    @Query() query: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { page, perPage } = pageParams(query, 20);
    const where = { customerId: user.id };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);
    const app = this.config.get<AppConfig>('app')!;
    const path = `${app.url.replace(/\/+$/, '')}/${app.apiPrefix}/payments/history`;
    return paginate(rows.map(paymentResource), total, page, perPage, path);
  }

  @Get(':id/receipt')
  async receipt(@CurrentUser() user: User, @Param('id') id: string): Promise<Record<string, unknown>> {
    const payment = await this.prisma.payment.findFirst({
      where: { id, customerId: user.id },
      include: { booking: { include: { errandType: true, runner: true } } },
    });
    if (!payment) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    const b = payment.booking;
    return {
      data: {
        payment: paymentResource(payment),
        booking: {
          booking_number: b?.bookingNumber ?? null,
          errand_type: b?.errandType?.name ?? null,
          pickup_address: b?.pickupAddress ?? null,
          dropoff_address: b?.dropoffAddress ?? null,
          runner_name: b?.runner?.fullName ?? null,
          completed_at: iso(b?.completedAt),
        },
      },
    };
  }
}
