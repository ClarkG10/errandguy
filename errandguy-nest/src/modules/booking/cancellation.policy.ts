import type { Booking } from '@prisma/client';

export interface CancellationPreview {
  fee: number;
  tier: 'free' | 'flat' | 'percentage';
  reason: string;
  cancellable: boolean;
}

/** Port of CancellationPolicy — status-based cancellation fee tiers. */
export class CancellationPolicy {
  static readonly ACCEPTED_FLAT_FEE = 20.0;
  static readonly ARRIVED_PERCENTAGE = 0.5;

  static preview(booking: Pick<Booking, 'status' | 'totalAmount'>): CancellationPreview {
    const status = booking.status;

    if (['completed', 'cancelled', 'no_runner'].includes(status)) {
      return { fee: 0, tier: 'free', reason: 'This booking can no longer be cancelled.', cancellable: false };
    }
    if (['pending', 'matched'].includes(status)) {
      return { fee: 0, tier: 'free', reason: 'No fee — runner has not accepted yet.', cancellable: true };
    }
    if (['accepted', 'heading_to_pickup'].includes(status)) {
      return {
        fee: CancellationPolicy.ACCEPTED_FLAT_FEE,
        tier: 'flat',
        reason: `A small ₱${CancellationPolicy.ACCEPTED_FLAT_FEE.toFixed(0)} fee applies — your runner is already on the way.`,
        cancellable: true,
      };
    }
    const fee = Math.round(Number(booking.totalAmount) * CancellationPolicy.ARRIVED_PERCENTAGE * 100) / 100;
    return {
      fee,
      tier: 'percentage',
      reason: `A ${Math.trunc(CancellationPolicy.ARRIVED_PERCENTAGE * 100)}% fee applies — your runner has already arrived or started the errand.`,
      cancellable: true,
    };
  }
}
