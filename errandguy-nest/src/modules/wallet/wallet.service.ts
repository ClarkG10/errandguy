import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WalletTransaction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { XenditService } from '../../integrations/xendit.service';
import { NotificationService } from '../../messaging/notification.service';
import { PaymentGatewayException } from '../../common/exceptions/payment-gateway.exception';
import type { AppConfig } from '../../config/configuration';

@Injectable()
export class WalletService {
  private readonly logger = new Logger('Wallet');

  constructor(
    private readonly prisma: PrismaService,
    private readonly xendit: XenditService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  async getBalance(userId: string): Promise<number> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { walletBalance: true } });
    return Number(u?.walletBalance ?? 0);
  }

  /**
   * Start a top-up: create a PENDING transaction + Xendit invoice. The balance
   * is NOT credited here — only the invoice.paid webhook calls completeTopUp.
   */
  async initiateTopUp(
    userId: string,
    amount: number,
    payerEmail?: string | null,
    successRedirectUrl?: string,
  ): Promise<{ transaction: WalletTransaction; checkout_url: string | null }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const transaction = await this.prisma.walletTransaction.create({
      data: {
        userId,
        type: 'top_up',
        amount: new Prisma.Decimal(amount),
        balanceAfter: user.walletBalance,
        status: 'pending',
        description: 'Wallet top-up (awaiting payment)',
      },
    });

    try {
      const invoice = await this.xendit.createInvoice({
        amount,
        externalId: `topup-${transaction.id}`,
        description: 'ErrandGuy wallet top-up',
        payerEmail: payerEmail ?? user.email ?? '',
        successRedirectUrl,
      });
      const updated = await this.prisma.walletTransaction.update({
        where: { id: transaction.id },
        data: { gatewayRef: invoice.id ?? null, checkoutUrl: invoice.invoice_url ?? null },
      });
      return { transaction: updated, checkout_url: invoice.invoice_url ?? null };
    } catch (e) {
      await this.prisma.walletTransaction.update({
        where: { id: transaction.id },
        data: {
          status: 'failed',
          failureReason: 'Could not create payment invoice.',
          processedAt: new Date(),
        },
      });
      this.logger.error(`Wallet top-up invoice creation failed: ${(e as Error).message}`);
      const reason =
        (e as { response?: { data?: { message?: string } } }).response?.data?.message ??
        (e as Error).message;
      throw new PaymentGatewayException(reason);
    }
  }

  /** Complete a top-up on invoice.paid. Idempotent. */
  async completeTopUp(
    transactionId: string,
    gatewayData: Record<string, unknown> = {},
  ): Promise<WalletTransaction | null> {
    let justCompleted = false;
    const transaction = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<WalletTransaction[]>(
        Prisma.sql`SELECT * FROM wallet_transactions WHERE id = ${transactionId}::uuid FOR UPDATE LIMIT 1`,
      );
      const t = rows[0];
      if (!t || t.status !== 'pending' || t.type !== 'top_up') return t ?? null;

      const userRows = await tx.$queryRaw<{ wallet_balance: Prisma.Decimal }[]>(
        Prisma.sql`SELECT wallet_balance FROM users WHERE id = ${t.userId}::uuid FOR UPDATE LIMIT 1`,
      );
      const newBalance = new Prisma.Decimal(userRows[0].wallet_balance).plus(t.amount);
      await tx.user.update({ where: { id: t.userId }, data: { walletBalance: newBalance } });

      const updated = await tx.walletTransaction.update({
        where: { id: t.id },
        data: {
          status: 'completed',
          balanceAfter: newBalance,
          processedAt: new Date(),
          description: 'Wallet top-up',
          gatewayRef: (gatewayData.id as string) ?? t.gatewayRef,
        },
      });
      justCompleted = true;
      return updated;
    });

    if (justCompleted && transaction) {
      const amount = Number(transaction.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const balance = Number(transaction.balanceAfter).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      await this.notifications.sendPush(
        transaction.userId,
        'Top-up complete',
        `₱${amount} was added to your wallet. New balance: ₱${balance}.`,
        { type: 'payment', status: 'completed', wallet_transaction_id: transaction.id },
      );
    }
    return transaction;
  }

  /** Mark a pending top-up failed on invoice.expired. Idempotent. */
  async expireTopUp(transactionId: string, reason = 'Invoice expired'): Promise<WalletTransaction | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<WalletTransaction[]>(
        Prisma.sql`SELECT * FROM wallet_transactions WHERE id = ${transactionId}::uuid FOR UPDATE LIMIT 1`,
      );
      const t = rows[0];
      if (!t || t.status !== 'pending' || t.type !== 'top_up') return t ?? null;
      return tx.walletTransaction.update({
        where: { id: t.id },
        data: { status: 'failed', failureReason: reason, processedAt: new Date(), description: 'Wallet top-up (expired)' },
      });
    });
  }

  async deduct(userId: string, amount: number, referenceId: string, description = 'Payment'): Promise<WalletTransaction> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ wallet_balance: Prisma.Decimal }[]>(
        Prisma.sql`SELECT wallet_balance FROM users WHERE id = ${userId}::uuid FOR UPDATE LIMIT 1`,
      );
      if (!rows.length) throw new Error('User not found.');
      const current = new Prisma.Decimal(rows[0].wallet_balance);
      if (current.lessThan(amount)) throw new Error('Insufficient wallet balance.');
      const newBalance = current.minus(amount);
      await tx.user.update({ where: { id: userId }, data: { walletBalance: newBalance } });
      return tx.walletTransaction.create({
        data: {
          userId,
          type: 'payment',
          amount: new Prisma.Decimal(-amount),
          balanceAfter: newBalance,
          referenceId,
          description,
        },
      });
    });
  }

  async refund(userId: string, amount: number, referenceId: string): Promise<WalletTransaction> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ wallet_balance: Prisma.Decimal }[]>(
        Prisma.sql`SELECT wallet_balance FROM users WHERE id = ${userId}::uuid FOR UPDATE LIMIT 1`,
      );
      const newBalance = new Prisma.Decimal(rows[0].wallet_balance).plus(amount);
      await tx.user.update({ where: { id: userId }, data: { walletBalance: newBalance } });
      return tx.walletTransaction.create({
        data: { userId, type: 'refund', amount: new Prisma.Decimal(amount), balanceAfter: newBalance, referenceId, description: 'Refund' },
      });
    });
  }

  async payout(userId: string, amount: number): Promise<WalletTransaction> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ wallet_balance: Prisma.Decimal }[]>(
        Prisma.sql`SELECT wallet_balance FROM users WHERE id = ${userId}::uuid FOR UPDATE LIMIT 1`,
      );
      if (!rows.length) throw new Error('User not found.');
      const current = new Prisma.Decimal(rows[0].wallet_balance);
      if (amount < 100) throw new Error('Minimum payout amount is ₱100.');
      if (current.lessThan(amount)) throw new Error('Insufficient wallet balance.');
      const newBalance = current.minus(amount);
      await tx.user.update({ where: { id: userId }, data: { walletBalance: newBalance } });
      return tx.walletTransaction.create({
        data: { userId, type: 'payout', amount: new Prisma.Decimal(-amount), balanceAfter: newBalance, referenceId: null, description: 'Payout to bank/e-wallet' },
      });
    });
  }

  successRedirectUrl(): string {
    return `${this.config.get<AppConfig>('app')!.url.replace(/\/+$/, '')}/payment/complete`;
  }
}
