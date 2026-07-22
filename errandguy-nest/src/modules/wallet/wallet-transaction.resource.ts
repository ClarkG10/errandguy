import type { Booking, ErrandType, WalletTransaction } from '@prisma/client';
import { dec, iso } from '../../common/serialization';

type BookingLite = Pick<Booking, 'id' | 'bookingNumber'> & { errandType?: Pick<ErrandType, 'name'> | null };

/** Reproduces the WalletTransaction `display_description` accessor. */
export function displayDescription(tx: WalletTransaction, booking?: BookingLite | null): string {
  const brand = 'ErrandGuy';
  if (['payment', 'earning', 'refund'].includes(tx.type) && tx.referenceId && booking) {
    const typeName = booking.errandType?.name ?? 'Errand';
    const shortNumber = booking.bookingNumber ?? booking.id.slice(0, 8);
    const verb = tx.type === 'payment' ? 'Paid for' : tx.type === 'earning' ? 'Earned from' : 'Refund for';
    return `${brand} · ${verb} ${typeName} #${shortNumber}`;
  }
  switch (tx.type) {
    case 'top_up':
      return `${brand} · Wallet top-up`;
    case 'payout':
      return `${brand} · Payout to bank or e-wallet`;
    case 'bonus':
      return `${brand} · Promotional bonus`;
    default:
      return tx.description ?? tx.type.charAt(0).toUpperCase() + tx.type.slice(1).replace(/_/g, ' ');
  }
}

/** Full WalletTransaction toArray() + appended display_description. */
export function walletTransactionResource(
  tx: WalletTransaction,
  booking?: BookingLite | null,
): Record<string, unknown> {
  return {
    id: tx.id,
    user_id: tx.userId,
    type: tx.type,
    amount: dec(tx.amount),
    balance_after: dec(tx.balanceAfter),
    reference_id: tx.referenceId,
    gateway_ref: tx.gatewayRef,
    checkout_url: tx.checkoutUrl,
    description: tx.description,
    status: tx.status,
    processed_at: iso(tx.processedAt),
    failure_reason: tx.failureReason,
    created_at: iso(tx.createdAt),
    display_description: displayDescription(tx, booking),
  };
}
