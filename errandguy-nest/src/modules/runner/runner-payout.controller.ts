import { Body, Controller, HttpCode, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Prisma, WalletTransaction, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { dec } from '../../common/serialization';
import { SystemConfigService } from '../payment/system-config.service';
import { PayoutDto } from './dto/runner.dto';

@Controller('runner')
@UseGuards(SanctumAuthGuard, ActiveGuard, RolesGuard)
@Roles('runner')
export class RunnerPayoutController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  @Post('payout/request')
  @HttpCode(HttpStatus.OK)
  @Idempotent(200)
  async requestPayout(@CurrentUser() user: User, @Body() dto: PayoutDto): Promise<Record<string, unknown>> {
    const profile = await this.prisma.runnerProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      throw new HttpException({ message: 'Runner profile not found.' }, HttpStatus.NOT_FOUND);
    }
    if (!profile.bankName && !profile.ewalletNumber) {
      throw new HttpException(
        { message: 'Please configure a bank account or e-wallet before requesting a payout.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const amount = Number(dto.amount);
    const minPayout = Number((await this.config.getValue('min_payout_amount', '100')) ?? '100');
    if (amount < minPayout) {
      throw new HttpException({ message: `Minimum payout amount is ₱${minPayout}.` }, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    let transaction: WalletTransaction;
    try {
      transaction = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ wallet_balance: Prisma.Decimal }[]>(
          Prisma.sql`SELECT wallet_balance FROM users WHERE id = ${user.id}::uuid FOR UPDATE LIMIT 1`,
        );
        if (!rows.length) throw new Error('insufficient');
        const balance = new Prisma.Decimal(rows[0].wallet_balance);
        if (balance.lessThan(amount)) throw new Error('insufficient');
        const newBalance = balance.minus(amount);
        const tx0 = await tx.walletTransaction.create({
          data: {
            userId: user.id,
            type: 'payout',
            amount: new Prisma.Decimal(-amount),
            balanceAfter: newBalance,
            description: 'Payout request',
            status: 'pending',
          },
        });
        await tx.user.update({ where: { id: user.id }, data: { walletBalance: newBalance } });
        return tx0;
      });
    } catch {
      throw new HttpException({ message: 'Insufficient wallet balance.' }, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    return {
      data: {
        user_id: transaction.userId,
        type: transaction.type,
        amount: dec(transaction.amount),
        balance_after: dec(transaction.balanceAfter),
        description: transaction.description,
        status: transaction.status,
        id: transaction.id,
        display_description: 'ErrandGuy · Payout to bank or e-wallet',
      },
      message: `Payout of ₱${amount} has been requested.`,
    };
  }
}
