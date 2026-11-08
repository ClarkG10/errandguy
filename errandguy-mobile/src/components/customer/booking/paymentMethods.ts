import type { PaymentMethodType } from '../../../types';

export interface PaymentOption {
  type: PaymentMethodType;
  label: string;
  description: string;
}

/**
 * Every way to pay, in the server catalog's order (PaymentMethodCatalog). None
 * needs anything saved: the wallet spends the balance the customer already
 * has, GCash and Maya are a one-time checkout in their app, and cash is
 * collected by the runner. Each description says what happens when the
 * customer confirms — when the money moves, and where.
 */
export const PAYMENT_OPTIONS: readonly PaymentOption[] = [
  { type: 'wallet', label: 'ErrandGuy Wallet', description: 'Paid from your wallet balance when you confirm' },
  { type: 'gcash', label: 'GCash', description: 'You’ll approve the payment in GCash after you confirm' },
  { type: 'maya', label: 'Maya', description: 'You’ll approve the payment in Maya after you confirm' },
  { type: 'cash', label: 'Cash on delivery', description: 'Pay your runner in cash when the errand is done' },
];

/** The customer-facing name of a payment method ("Cash on delivery", "GCash"). */
export function paymentMethodLabel(type: string | null | undefined): string | null {
  if (!type) return null;
  return (
    PAYMENT_OPTIONS.find((o) => o.type === type)?.label ??
    type.charAt(0).toUpperCase() + type.slice(1)
  );
}
