import { useCallback, useEffect, useRef } from 'react';
import { useSmartPolling } from './useSmartPolling';
import { useNetworkStore } from '../stores/networkStore';
import { paymentService } from '../services/payment.service';
import {
  usePaymentStore,
  type PaymentAttempt,
  type AttemptStatus,
} from '../stores/paymentStore';
import type { PaymentStage } from '../components/ui/PaymentProgress';

/**
 * The shared engine that VERIFIES a payment attempt against the backend — used
 * by both return paths (the in-app checkout sheet return AND the
 * payment-complete deep link), driven entirely off the persisted attempt so it
 * resumes after a leave/relaunch.
 *
 * Rules that keep money honest:
 *  • Only an explicit backend terminal status flips the attempt to success or
 *    failed. A thrown/offline/404 tick NEVER means failure — the poll just
 *    backs off and keeps trying (so an undeployed endpoint or a dropped
 *    connection degrades to "still verifying", never a false failure).
 *  • After a short wait with no confirmation we move to the honest `pending`
 *    state ("you can safely leave, we'll notify you") while continuing to poll.
 *  • Payouts have no gateway redirect, so they aren't polled here.
 */

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_INTERVAL_MS = 15000;
// After this long unconfirmed, show the honest "being processed" state.
const PENDING_AFTER_MS = 35000;

const POLL_STATUSES: AttemptStatus[] = ['awaiting_gateway', 'verifying', 'pending'];

export function attemptToStage(status?: AttemptStatus | null): PaymentStage | null {
  switch (status) {
    case 'preparing':
      return 'preparing';
    case 'awaiting_gateway':
      return 'redirecting';
    case 'verifying':
      return 'verifying';
    case 'pending':
      return 'pending';
    case 'success':
      return 'success';
    case 'failed':
      return 'failed';
    default:
      return null;
  }
}

function pollId(attempt: PaymentAttempt): string | null {
  // 'tip' rides its wallet_transaction id in topupId (same status endpoint).
  if (attempt.kind === 'topup' || attempt.kind === 'tip') return attempt.topupId ?? null;
  return attempt.paymentId ?? attempt.bookingId ?? null;
}

async function fetchProbe(attempt: PaymentAttempt): Promise<any | null> {
  if (attempt.kind === 'topup' || attempt.kind === 'tip') {
    if (!attempt.topupId) return null;
    const res = await paymentService.getTopUpStatus(attempt.topupId);
    return res?.data?.data ?? res?.data ?? null;
  }
  if (attempt.paymentId) {
    const res = await paymentService.getPaymentStatus(attempt.paymentId);
    return res?.data?.data ?? res?.data ?? null;
  }
  if (attempt.bookingId) {
    const res = await paymentService.getBookingPaymentStatus(attempt.bookingId);
    return res?.data?.data ?? res?.data ?? null;
  }
  return null;
}

export interface PaymentVerificationState {
  attempt: PaymentAttempt | null;
  stage: PaymentStage | null;
  isOffline: boolean;
}

export function usePaymentVerification(): PaymentVerificationState {
  const attempt = usePaymentStore((s) => s.attempt);
  const setStatus = usePaymentStore((s) => s.setStatus);
  const isOffline = useNetworkStore((s) => s.isOffline);

  // Guard against overlapping ticks writing twice (useSmartPolling already
  // serializes, but a store write from a stale closure is cheap to avoid).
  const inFlight = useRef(false);

  const shouldPoll =
    !!attempt &&
    attempt.kind !== 'payout' &&
    POLL_STATUSES.includes(attempt.status) &&
    !!pollId(attempt);

  // Safety net: a non-payout attempt stuck in 'verifying' with no pollId can
  // never poll (shouldPoll is false), so the tick that flips to the honest,
  // dismissable 'pending' state never runs — leaving the user on a button-less
  // spinner modal they can't close (iOS). Flip it to 'pending' so verification
  // always terminates somewhere the user can leave. Scoped to 'verifying'
  // (NOT the 'awaiting_gateway' redirect window, where the checkout URL opens).
  useEffect(() => {
    if (attempt && attempt.kind !== 'payout' && attempt.status === 'verifying' && !pollId(attempt)) {
      setStatus('pending');
    }
  }, [attempt, setStatus]);

  // GUARANTEED escape hatch — independent of the poll. A payment-status endpoint
  // that ERRORS on every tick (undeployed, a 500 from a WIP change, a 404, an
  // auth blip) makes tick() throw BEFORE it can reach its own pending-transition
  // below — which would trap the user forever behind the button-less 'verifying'
  // overlay (a full-screen Modal with no dismiss control on iOS). This timer
  // flips 'verifying' → the honest, dismissable 'pending' state after
  // PENDING_AFTER_MS no matter what the poll does, so a broken money-status
  // endpoint degrades to "we'll notify you" but can NEVER brick the app. Keyed
  // off the persisted startedAt, so it also bounds a rehydrated attempt.
  useEffect(() => {
    if (!attempt || attempt.kind === 'payout' || attempt.status !== 'verifying') return;
    const flip = () => {
      const cur = usePaymentStore.getState().attempt;
      if (cur && cur.status === 'verifying') setStatus('pending');
    };
    const remaining = PENDING_AFTER_MS - (Date.now() - attempt.startedAt);
    if (remaining <= 0) {
      flip();
      return;
    }
    const timer = setTimeout(flip, remaining);
    return () => clearTimeout(timer);
  }, [attempt, setStatus]);

  const tick = useCallback(async () => {
    const current = usePaymentStore.getState().attempt;
    if (!current || current.kind === 'payout' || !POLL_STATUSES.includes(current.status)) return;
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const probe = await fetchProbe(current); // throws on network/404 → backoff
      const status: string | undefined = probe?.status;

      if (status === 'completed') {
        setStatus('success', {
          reference: probe.reference ?? current.reference,
          method: probe.method ?? current.method,
          paidAt: probe.paid_at ?? probe.processed_at ?? undefined,
          amount: typeof probe.amount === 'number' ? probe.amount : current.amount,
        });
        return;
      }

      if (
        status === 'failed' ||
        status === 'expired' ||
        status === 'cancelled' ||
        status === 'refunded'
      ) {
        setStatus('failed', { failureReason: probe.failure_reason ?? status });
        return;
      }

      // Still pending/processing (or unknown non-terminal). After a short wait
      // with no confirmation, surface the honest "being processed" state.
      const elapsed = Date.now() - current.startedAt;
      if (current.status === 'awaiting_gateway' || current.status === 'verifying') {
        if (elapsed > PENDING_AFTER_MS) setStatus('pending');
        else if (current.status === 'awaiting_gateway') setStatus('verifying');
      }
    } catch (err) {
      // A thrown probe (404/500/offline) is NEVER a payment failure — but it
      // must not starve the pending-transition above, which sits after the
      // throwing await. Degrade to the dismissable 'pending' state once we've
      // waited long enough (defense-in-depth alongside the timeout effect), then
      // rethrow so useSmartPolling still applies its error backoff.
      const elapsed = Date.now() - current.startedAt;
      if (
        elapsed > PENDING_AFTER_MS &&
        (current.status === 'awaiting_gateway' || current.status === 'verifying')
      ) {
        setStatus('pending');
      }
      throw err;
    } finally {
      inFlight.current = false;
    }
  }, [setStatus]);

  useSmartPolling(tick, {
    interval: POLL_INTERVAL_MS,
    enabled: shouldPoll,
    runOnMount: true,
    pauseWhenOffline: true,
    backoffOnError: true,
    maxInterval: POLL_MAX_INTERVAL_MS,
  });

  return {
    attempt,
    stage: attemptToStage(attempt?.status),
    isOffline,
  };
}
