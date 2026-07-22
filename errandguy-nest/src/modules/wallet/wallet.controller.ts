import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RouteThrottle } from '../../common/throttling/throttle.decorators';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { LaravelValidationException } from '../../common/exceptions/validation.exception';
import { PaymentGatewayException } from '../../common/exceptions/payment-gateway.exception';
import { paginate, pageParams } from '../../common/pagination';
import { iso } from '../../common/serialization';
import type { AppConfig } from '../../config/configuration';
import { WalletService } from './wallet.service';
import { walletTransactionResource } from './wallet-transaction.resource';
import { TopUpDto } from './dto/top-up.dto';

@Controller('wallet')
@UseGuards(SanctumAuthGuard, ActiveGuard)
export class WalletController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly config: ConfigService,
  ) {}

  @Get('balance')
  async balance(@CurrentUser() user: User): Promise<Record<string, unknown>> {
    return { data: { balance: await this.wallet.getBalance(user.id) } };
  }

  @Post('top-up')
  @HttpCode(HttpStatus.CREATED)
  @RouteThrottle(5, 1)
  @Idempotent(201)
  async topUp(@CurrentUser() user: User, @Body() dto: TopUpDto): Promise<Record<string, unknown>> {
    if (dto.payment_method_id) {
      const owned = await this.prisma.paymentMethod.findFirst({
        where: { id: dto.payment_method_id, userId: user.id },
        select: { id: true },
      });
      if (!owned) {
        throw LaravelValidationException.field(
          'payment_method_id',
          'Selected payment method is not available on your account.',
        );
      }
    }

    // 60s duplicate-tap guard: reuse a recent pending top-up of the same amount.
    const dup = await this.prisma.walletTransaction.findFirst({
      where: {
        userId: user.id,
        type: 'top_up',
        status: 'pending',
        amount: dto.amount,
        createdAt: { gte: new Date(Date.now() - 60_000) },
        checkoutUrl: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (dup) {
      return {
        data: walletTransactionResource(dup),
        checkout_url: dup.checkoutUrl,
        idempotent: true,
      };
    }

    try {
      const result = await this.wallet.initiateTopUp(
        user.id,
        dto.amount,
        user.email,
        this.wallet.successRedirectUrl(),
      );
      return {
        data: walletTransactionResource(result.transaction),
        checkout_url: result.checkout_url,
      };
    } catch (e) {
      const debug = this.config.get<AppConfig>('app')!.env !== 'production';
      const message =
        debug && e instanceof PaymentGatewayException
          ? `Payment gateway error: ${e.reason()}`
          : 'We couldn’t start your payment right now. Please try again in a moment.';
      throw new HttpException({ message }, HttpStatus.BAD_GATEWAY);
    }
  }

  @Get('transactions')
  async transactions(
    @CurrentUser() user: User,
    @Query() query: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { page, perPage } = pageParams(query, 20);
    const where: Record<string, unknown> = { userId: user.id };
    if (query.type) where.type = String(query.type);
    if (query.date_from) where.createdAt = { gte: new Date(`${String(query.date_from)}T00:00:00`) };
    if (query.date_to) {
      where.createdAt = {
        ...(where.createdAt as object),
        lte: new Date(`${String(query.date_to)}T23:59:59.999`),
      };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.walletTransaction.count({ where }),
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    // Enrich booking-linked rows for display_description.
    const bookingIds = rows
      .filter((r) => ['payment', 'earning', 'refund'].includes(r.type) && r.referenceId)
      .map((r) => r.referenceId!) as string[];
    const bookings = bookingIds.length
      ? await this.prisma.booking.findMany({
          where: { id: { in: bookingIds } },
          select: { id: true, bookingNumber: true, errandType: { select: { name: true } } },
        })
      : [];
    const bookingMap = new Map(bookings.map((b) => [b.id, b]));

    const app = this.config.get<AppConfig>('app')!;
    const path = `${app.url.replace(/\/+$/, '')}/${app.apiPrefix}/wallet/transactions`;
    return paginate(
      rows.map((r) => walletTransactionResource(r, r.referenceId ? bookingMap.get(r.referenceId) : null)),
      total,
      page,
      perPage,
      path,
    );
  }

  @Get('transactions/:id/status')
  async transactionStatus(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    const tx = await this.prisma.walletTransaction.findFirst({ where: { id, userId: user.id } });
    if (!tx) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    return {
      data: {
        transaction_id: tx.id,
        status: tx.status,
        type: tx.type,
        amount: Number(tx.amount),
        balance_after: Number(tx.balanceAfter),
        failure_reason: tx.status === 'failed' ? tx.failureReason : null,
        processed_at: iso(tx.processedAt),
      },
    };
  }
}
