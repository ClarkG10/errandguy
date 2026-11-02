import { formatCurrency } from './formatCurrency';

/**
 * GET /bookings/{id}/cancel-preview. `refund_amount` / `refund_destination`
 * are additive (what comes BACK and where it lands), optional so a cached
 * response from an older server still types.
 */
export interface CancelPreview {
  fee: number;
  tier: 'free' | 'flat' | 'percentage';
  reason: string;
  cancellable: boolean;
  refund_amount?: number | null;
  refund_destination?: 'wallet' | null;
}

/**
 * Confirm-modal body for a cancel preview.
 *
 * The fee alone answered the wrong question. A prepaid customer was told "a
 * small ₱20.00 fee applies" and asked to confirm "Cancel & pay ₱20" — which
 * reads as a NEW charge on a fare they had already been charged — and was
 * never told the ₱480 was coming back, nor that it lands in their ErrandGuy
 * wallet rather than back on their GCash. Both figures are the server's
 * (GET /bookings/{id}/cancel-preview); the locked re-evaluation inside cancel()
 * remains the authority and its response carries the settled receipt.
 *
 * Shared by every screen that cancels an errand, so none of them can drift
 * back to a hard-coded promise ("No fee will be charged") the server never
 * made.
 */
export function cancelMoneyLines(p: {
  fee: number;
  reason: string;
  refund_amount?: number | null;
  refund_destination?: 'wallet' | null;
}): string {
  const n = (v: unknown) => {
    const parsed = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const fee = n(p.fee);
  const refund = p.refund_amount == null ? 0 : n(p.refund_amount);

  const detail: string[] = [];
  if (fee > 0) detail.push(`Cancellation fee: ${formatCurrency(fee)}`);
  if (refund > 0) {
    detail.push(
      p.refund_destination === 'wallet'
        ? `Back to your ErrandGuy wallet: ${formatCurrency(refund)}`
        : `Refunded to you: ${formatCurrency(refund)}`,
    );
  } else if (fee > 0) {
    // Honest about the capped-fee case rather than leaving a silent gap
    // where the refund line would be.
    detail.push('Nothing is left to refund after the fee.');
  }

  return detail.length > 0 ? `${p.reason}\n\n${detail.join('\n')}` : p.reason;
}

/** The cancel response's receipt sentence (fee, refund, new wallet balance). */
export function cancelReceiptMessage(res: unknown): string | null {
  const message = (res as { data?: { message?: unknown } } | null | undefined)?.data?.message;
  return typeof message === 'string' && message.trim() ? message : null;
}
