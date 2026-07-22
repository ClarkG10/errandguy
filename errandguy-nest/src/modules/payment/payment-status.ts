import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Canonical Payment lifecycle (mirrors App\Enums\PaymentStatus). */
export enum PaymentStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
  Expired = 'expired',
  Cancelled = 'cancelled',
  Refunded = 'refunded',
}

const ALLOWED: Record<string, string[]> = {
  [PaymentStatus.Pending]: [
    PaymentStatus.Processing,
    PaymentStatus.Completed,
    PaymentStatus.Failed,
    PaymentStatus.Expired,
    PaymentStatus.Cancelled,
  ],
  [PaymentStatus.Processing]: [
    PaymentStatus.Completed,
    PaymentStatus.Failed,
    PaymentStatus.Expired,
    PaymentStatus.Cancelled,
  ],
  [PaymentStatus.Completed]: [PaymentStatus.Refunded],
  [PaymentStatus.Failed]: [],
  [PaymentStatus.Expired]: [],
  [PaymentStatus.Cancelled]: [],
  [PaymentStatus.Refunded]: [],
};

export function canTransitionTo(from: string, to: PaymentStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export function isTerminal(status: string): boolean {
  return (ALLOWED[status] ?? []).length === 0;
}

/** Thrown on an illegal transition (mirrors InvalidStatusTransitionException → 500). */
export class InvalidStatusTransitionError extends Error {
  constructor(from: string | null, to: string) {
    super(`Illegal payment status transition: ${from} → ${to}.`);
  }
}

type TxClient = Prisma.TransactionClient | PrismaService;

/**
 * The single funnel for changing a payment's status — validates the move,
 * applies side-column updates, and writes an immutable audit row. Idempotent
 * no-op when already at `to`. Mirrors Payment::transitionTo(). Run inside the
 * caller's transaction (webhook handlers hold a row lock).
 */
export async function transitionPayment(
  tx: TxClient,
  payment: { id: string; status: string },
  to: PaymentStatus,
  opts: {
    actor?: string;
    reason?: string | null;
    meta?: Record<string, unknown> | null;
    extra?: Prisma.PaymentUpdateInput;
  } = {},
): Promise<boolean> {
  const from = payment.status;
  if (from === to) return false; // no-op; never re-apply extra
  if (from && !canTransitionTo(from, to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
  await tx.payment.update({ where: { id: payment.id }, data: { ...opts.extra, status: to } });
  await tx.paymentStatusTransition.create({
    data: {
      paymentId: payment.id,
      fromStatus: from,
      toStatus: to,
      actor: opts.actor ?? 'system',
      reason: opts.reason ?? null,
      meta: opts.meta && Object.keys(opts.meta).length ? (opts.meta as Prisma.InputJsonValue) : Prisma.JsonNull,
      createdAt: new Date(),
    },
  });
  return true;
}
