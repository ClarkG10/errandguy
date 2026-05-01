import React from 'react';
import { Button } from '../ui/Button';
import type { BookingStatus } from '../../types';
import {
  getErrandTypeRule,
  type BookingStatusKey,
} from '../../constants/errandTypeRules';

interface StatusActionButtonProps {
  status: BookingStatus;
  /** Errand type slug from booking.errand_type?.slug. Drives the per-type label + flow. */
  errandSlug?: string | null;
  isTransportation?: boolean;
  pinVerified?: boolean;
  onPress: () => void;
  loading?: boolean;
}

/**
 * Returns the next status the runner should advance to, honoring the
 * per-errand-type flow (e.g. queue/bills_payment skip the dropoff stages).
 *
 * 'matched' is treated as 'accepted' for advancement purposes — the
 * server flips matched→accepted on POST /accept, but realtime/poll lag
 * can leave the local store on 'matched' for a beat. Without this
 * fallback the next-status lookup returns null and the runner is
 * stuck with no working button.
 */
export function getNextStatus(
  current: string,
  errandSlug?: string | null,
): string | null {
  const flow = getErrandTypeRule(errandSlug).statusFlow;
  const effective = current === 'matched' ? 'accepted' : current;
  const idx = flow.indexOf(effective as BookingStatusKey);
  if (idx === -1 || idx >= flow.length - 1) return null;
  return flow[idx + 1];
}

export function StatusActionButton({
  status,
  errandSlug,
  isTransportation,
  pinVerified,
  onPress,
  loading,
}: StatusActionButtonProps) {
  const rule = getErrandTypeRule(errandSlug);
  // Treat 'matched' as 'accepted' for the action label so the runner
  // sees the same "Head to pickup" CTA even if the optimistic store
  // update from acceptErrand hasn't reached this screen yet.
  const labelKey = (status === 'matched' ? 'accepted' : status) as BookingStatusKey;
  const label = rule.statusActions[labelKey];

  if (!label) return null;

  // For transportation: disable ride start until PIN is verified
  const disabled =
    isTransportation &&
    status === 'arrived_at_pickup' &&
    !pinVerified;

  return (
    <Button
      title={label}
      onPress={onPress}
      loading={loading}
      disabled={disabled}
      fullWidth
    />
  );
}
