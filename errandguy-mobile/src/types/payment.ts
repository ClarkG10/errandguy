export type PaymentMethodType = 'card' | 'gcash' | 'maya' | 'grabpay' | 'wallet' | 'cash';

/** Lifecycle of a linked/saved method (Xendit tokenization). */
export type PaymentMethodStatus = 'active' | 'pending' | 'expired' | 'failed';

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

/** Authoritative status probe returned by GET /wallet/transactions/{id}/status. */
export interface TopUpStatusProbe {
  transaction_id: string;
  status: 'pending' | 'completed' | 'failed';
  type: WalletTransactionType;
  amount: number;
  balance_after: number;
  failure_reason: string | null;
  processed_at: string | null;
}

export type WalletTransactionType =
  | 'top_up'
  | 'payment'
  | 'refund'
  | 'payout'
  | 'bonus'
  // Signed-both-ways / runner-side movements. Their `amount` sign is the source
  // of truth for credit-vs-debit (a positive adjustment/tip/earning is a
  // credit), unlike the fixed-direction types above.
  | 'tip'
  | 'earning'
  | 'adjustment';

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

export interface PaymentMethod {
  id: string;
  user_id: string;
  type: PaymentMethodType;
  /** 'active' = linked & chargeable; 'pending' = awaiting authorization. */
  status?: PaymentMethodStatus;
  label: string;
  is_default: boolean;
  last_four: string | null;
  card_brand: string | null;
  channel_code?: string | null;
  expires_at: string | null;
  created_at: string;
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
   * "ErrandGuy · Paid for Document delivery #A1B2C3".
   * Falls back to `description` when older rows or unknown types are
   * encountered. Always prefer this over `description` in UI.
   */
  display_description?: string | null;
  /**
   * Lifecycle state — ALWAYS check it before rendering a row as settled money.
   * A top_up is written 'pending' BEFORE Xendit confirms and only flips to
   * 'completed' on the paid webhook (or 'failed' when the customer abandons
   * checkout / the invoice expires) — so a pending/failed top-up must never be
   * shown as a completed credit. Payout requests likewise start 'pending' until
   * an operator settles them. Payments/refunds/bonuses settle when written.
   */
  status?: 'pending' | 'completed' | 'failed';
  processed_at?: string | null;
  failure_reason?: string | null;
  created_at: string;
}
