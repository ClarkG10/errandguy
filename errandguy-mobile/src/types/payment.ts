export type PaymentMethodType = 'card' | 'gcash' | 'maya' | 'wallet' | 'cash';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'refunded';

export type WalletTransactionType =
  | 'top_up'
  | 'payment'
  | 'refund'
  | 'payout'
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

export interface PaymentMethod {
  id: string;
  user_id: string;
  type: PaymentMethodType;
  label: string;
  gateway_token: string | null;
  is_default: boolean;
  last_four: string | null;
  card_brand: string | null;
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
  created_at: string;
}
