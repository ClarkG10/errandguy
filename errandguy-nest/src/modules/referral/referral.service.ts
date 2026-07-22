import { Injectable } from '@nestjs/common';
import { Prisma, Referral } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { NotificationService } from '../../messaging/notification.service';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

/** Machine keys thrown by attach() and mapped to friendly 422s by the controller. */
export class ReferralError extends Error {}

/** Port of ReferralService. */
@Injectable()
export class ReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly notifications: NotificationService,
  ) {}

  /** Unique 8-char code, re-rolled on collision. */
  async generateCode(): Promise<string> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let code = '';
      for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(0, ALPHABET.length)];
      const exists = await this.prisma.user.findFirst({
        where: { referralCode: code },
        select: { id: true },
      });
      if (!exists) return code;
    }
  }

  /** Attach a referrer to the referee via code. Throws ReferralError machine keys. */
  async attach(refereeId: string, rawCode: string): Promise<Referral> {
    const code = rawCode.trim().toUpperCase();
    return this.prisma.$transaction(async (tx) => {
      const referrer = await tx.user.findFirst({ where: { referralCode: code } });
      if (!referrer) throw new ReferralError('invalid_code');
      if (referrer.id === refereeId) throw new ReferralError('self_referral');

      // Lock the referee row.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${refereeId}::uuid FOR UPDATE`;
      const referee = await tx.user.findUnique({ where: { id: refereeId } });
      if (!referee) throw new ReferralError('referee_missing');

      const already =
        !!referee.referredBy ||
        (await tx.referral.findFirst({ where: { refereeId }, select: { id: true } })) !== null;
      if (already) throw new ReferralError('already_referred');

      const referral = await tx.referral.create({
        data: { referrerId: referrer.id, refereeId, status: 'pending' },
      });
      await tx.user.update({ where: { id: refereeId }, data: { referredBy: referrer.id } });
      return referral;
    });
  }

  /** Reward BOTH parties on the referee's first completed booking. Idempotent. */
  async reward(refereeId: string): Promise<Referral | null> {
    const amount = await this.rewardAmount();

    const rewarded = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Referral[]>(
        Prisma.sql`SELECT * FROM referrals WHERE referee_id = ${refereeId}::uuid FOR UPDATE LIMIT 1`,
      );
      const referral = rows[0];
      if (!referral || referral.status === 'rewarded') return null;

      await this.creditBonus(
        tx,
        referral.referrerId,
        amount,
        referral.id,
        'ErrandGuy referral reward — your friend completed their first errand!',
      );
      await this.creditBonus(
        tx,
        referral.refereeId,
        amount,
        referral.id,
        'ErrandGuy welcome reward — thanks for joining via a referral!',
      );

      return tx.referral.update({
        where: { id: referral.id },
        data: {
          status: 'rewarded',
          rewardAmount: new Prisma.Decimal(amount),
          qualifiedAt: referral.qualifiedAt ?? new Date(),
          rewardedAt: new Date(),
        },
      });
    });

    if (rewarded) {
      const amt = Number(rewarded.rewardAmount ?? amount);
      const display = Number.isInteger(amt) ? String(amt) : String(amt);
      await this.notifications.sendPush(
        rewarded.referrerId,
        'Referral Reward!',
        `You earned ₱${display} — your friend completed their first errand.`,
        { type: 'referral', referral_id: rewarded.id },
      );
      await this.notifications.sendPush(
        rewarded.refereeId,
        'Welcome Bonus!',
        `You earned ₱${display} for joining ErrandGuy through a referral.`,
        { type: 'referral', referral_id: rewarded.id },
      );
    }
    return rewarded;
  }

  private async rewardAmount(): Promise<number> {
    const value = await this.cache.remember(
      'system_config:referral_reward_amount',
      async () => {
        const row = await this.prisma.systemConfig.findUnique({
          where: { key: 'referral_reward_amount' },
        });
        return row?.value ?? '50';
      },
      3600,
    );
    const n = Number(value);
    return Number.isFinite(n) ? n : 50;
  }

  /** Lock user → compute balance → insert bonus tx → update balance. Runs inside a tx. */
  private async creditBonus(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    referenceId: string,
    description: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ wallet_balance: Prisma.Decimal }[]>(
      Prisma.sql`SELECT wallet_balance FROM users WHERE id = ${userId}::uuid FOR UPDATE LIMIT 1`,
    );
    if (!rows.length) return;
    const newBalance = new Prisma.Decimal(rows[0].wallet_balance).plus(amount);
    await tx.walletTransaction.create({
      data: {
        userId,
        type: 'bonus',
        amount: new Prisma.Decimal(amount),
        balanceAfter: newBalance,
        referenceId,
        description,
      },
    });
    await tx.user.update({ where: { id: userId }, data: { walletBalance: newBalance } });
  }
}
