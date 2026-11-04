/**
 * The ways a customer can pay for an errand: cash to the runner, a one-time
 * GCash or Maya checkout, or the ErrandGuy wallet balance they already hold.
 * Exactly what GET /payments/available-methods can return.
 */
export type PaymentMethodType = 'gcash' | 'maya' | 'wallet' | 'cash';

/** Where withdrawn or paid-out money goes (PayoutDestination on the server). */
export type PayoutChannel = 'gcash' | 'maya' | 'bank';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'refunded';

/** Authoritative status probe returned by GET /payments/{id}/status. */
export interface PaymentStatusProbe {
  payment_id: string;
  status: PaymentStatus;
  booking_id: string | null;
  booking_payment_status: string | null;
  amount: number;
  method: PaymentMethodType | string | null;
  reference: string | null;
  paid_at: string | null;
  failure_reason: string | null;
}

/**
 * Authoritative status probe returned by GET /wallet/transactions/{id}/status,
 * which the app polls to verify a GCash/Maya tip charge.
 */
export interface WalletTransactionStatusProbe {
  transaction_id: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  type: WalletTransactionType;
  amount: number;
  balance_after: number;
  failure_reason: string | null;
  processed_at: string | null;
}

/**
 * GET /wallet/balance → `data`.
 *
 * `balance` is the withdrawable wallet (negative for a runner who owes money
 * from cash errands), `withdrawable` is what can actually be withdrawn (never
 * below zero), and `bonus_balance` is credit left from the retired referral
 * program: spendable on errands, never withdrawable, and never added to.
 */
export interface WalletSummary {
  balance: number;
  withdrawable: number;
  bonus_balance: number;
  /** The smallest withdrawal the server accepts (₱100 for customers today).
   *  Absent on an older server — callers fall back to DEFAULT_WITHDRAW_MIN. */
  withdraw_min?: number;
  /** Owing this much from cash errands pauses cash work (₱; 0 = no limit),
   *  from the server's `runner_cash_debt_limit`. Absent on an older server —
   *  callers fall back to CASH_DEBT_LIMIT_FALLBACK. */
  cash_debt_limit?: number;
}

export type WalletTransactionType =
  | 'payment'
  | 'refund'
  /** Money out to GCash, Maya or a bank: a runner payout or a customer withdrawal. */
  | 'payout'
  // Signed-both-ways / runner-side movements. Their `amount` sign is the source
  // of truth for credit-vs-debit (a positive adjustment/tip/earning is a
  // credit), unlike the fixed-direction types above.
  | 'tip'
  | 'earning'
  | 'adjustment'
  /** The platform's cut of a cash errand, debited from the runner's wallet. */
  | 'commission'
  /** Paid to the runner when a customer cancels after they accepted. */
  | 'cancel_fee'
  // Legacy rows only: wallet top-ups and referral bonuses are retired, but
  // the ledger keeps the ones written before that, so histories still show them.
  | 'top_up'
  | 'bonus';

export interface Payment {
  id: string;
  booking_id: string;
  customer_id: string;
  amount: number;
  currency: string;
  method: PaymentMethodType;
  status: PaymentStatus;
  gateway_tx_id: string | null;
  gateway_response: Record<string, unknown> | null;
  paid_at: string | null;
  refund_amount: number | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  type: WalletTransactionType;
  amount: number;
  balance_after: number;
  reference_id: string | null;
  description: string | null;
  /**
   * Server-side composed customer-facing label, e.g.
   * "ErrandGuy · Paid for Document delivery #A1B2C3" or
   * "ErrandGuy · Payout to GCash •••• 4567".
   * Falls back to `description` when older rows or unknown types are
   * encountered. Always prefer this over `description` in UI.
   */
  display_description?: string | null;
  /**
   * Lifecycle state — ALWAYS check it before rendering a row as settled money.
   * A payout (a runner payout or a customer withdrawal) starts 'pending' until
   * staff send it, and may end 'failed' (the money comes back). Payments,
   * refunds and earnings settle when written.
   */
  status?: 'pending' | 'completed' | 'failed';
  processed_at?: string | null;
  failure_reason?: string | null;
  created_at: string;
}
