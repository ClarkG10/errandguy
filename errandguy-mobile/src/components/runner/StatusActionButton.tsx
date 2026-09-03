import React from 'react';
import { Button } from '../ui/Button';
import { SlideToConfirm } from '../ui/SlideToConfirm';
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

/**
 * The exact label the runner's action button shows for a status — the single
 * source of truth for "what is this runner about to tap".
 *
 * Exported because the runner HOME card previously carried its own phase-copy
 * map and promised a different action from the button it opened ("Mark item
 * picked up" over a cockpit reading "Pick up item"), and its drop-off wording
 * ("En route to drop-off") described a leg that single-location errands — a
 * bill payment, a queue job — do not have. Both surfaces now read from here,
 * so the promise on the card is the button underneath it.
 *
 * Returns null when there is nothing to advance (terminal statuses).
 */
export function statusActionLabel(
  status: BookingStatus,
  errandSlug?: string | null,
): string | null {
  // `matched` means the errand has been OFFERED to this runner and is not
  // theirs yet — the state a "New errand offer" push tap lands in. It used to
  // borrow the 'accepted' label ("Head to pickup"), which both misdescribed
  // the job and fired a status advance the server rejects before an accept.
  // Name the actual next action; the cockpit's handler claims the errand.
  if (status === 'matched') return 'Accept errand';
  const rule = getErrandTypeRule(errandSlug);

  return rule.statusActions[status as BookingStatusKey] ?? null;
}

export function StatusActionButton({
  status,
  errandSlug,
  isTransportation,
  pinVerified,
  onPress,
  loading,
}: StatusActionButtonProps) {
  const label = statusActionLabel(status, errandSlug);

  if (!label) return null;

  // For transportation: disable ride start until PIN is verified
  const disabled =
    isTransportation &&
    status === 'arrived_at_pickup' &&
    !pinVerified;

  // Consequential, hard-to-undo transitions (handing over / completing)
  // get a slide-to-confirm instead of a tap — a drag is deliberately
  // harder to fire by accident while the phone is in a pocket or the
  // runner is fumbling one-handed. Earlier transitions stay taps.
  const nextStatus = getNextStatus(status, errandSlug);
  const isConsequential = nextStatus === 'delivered' || nextStatus === 'completed';

  if (isConsequential) {
    // Reuse the per-type label wording, e.g. "Slide to hand over item",
    // "Slide to complete ride". Labels are sentence-case verbs, so
    // lowercasing the first character keeps them reading naturally.
    const slideLabel = `Slide to ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
    return (
      <SlideToConfirm
        label={slideLabel}
        onComplete={onPress}
        loading={loading}
        disabled={disabled}
      />
    );
  }

  return (
    <Button
      title={label}
      onPress={onPress}
      loading={loading}
      loadingTitle="Updating…"
      disabled={disabled}
      // The single most-tapped control in the product, hit one-handed
      // outdoors and often at a motorcycle stop. 44dp painted, not just slop.
      size="lg"
      accessibilityHint={
        disabled
          ? 'Disabled until the passenger’s 4-digit ride PIN is verified above'
          : undefined
      }
      fullWidth
    />
  );
}
