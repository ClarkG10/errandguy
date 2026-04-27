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
 */
export function getNextStatus(
  current: string,
  errandSlug?: string | null,
): string | null {
  const flow = getErrandTypeRule(errandSlug).statusFlow;
  const idx = flow.indexOf(current as BookingStatusKey);
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
  const label = rule.statusActions[status as BookingStatusKey];

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
