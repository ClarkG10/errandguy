import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { useRouter } from 'expo-router';
import { openCheckoutUrl, PAYMENT_RETURN_URL } from '../utils/browser';
import { bookingCheckoutUrl, UNPAID_CHECKOUT_WINDOW_MINUTES } from '../utils/bookingPayment';
import { mapFailureReason } from '../utils/paymentErrors';
import { usePaymentStore, isAttemptActive } from '../stores/paymentStore';
import { usePaymentVerification } from './usePaymentVerification';
import { toast } from '../stores/toastStore';
import type { PaymentProgress } from '../components/ui/PaymentProgress';
import type { Booking } from '../types';

/** Marks an attempt whose gateway sheet the customer dismissed without paying,
 *  so the failure overlay can offer "Resume payment" with honest copy instead
 *  of the generic "we couldn't confirm this payment". */
export const CHECKOUT_CANCELLED = 'checkout_cancelled';

/** What the failure overlay says after the customer backs out of checkout.
 *  The way back is real: the waiting screen and the errand both carry a
 *  "Complete payment" button that reopens the same checkout. */
export const CHECKOUT_CANCELLED_MESSAGE =
  `You closed checkout before paying, so nothing was charged and no runner has been sent yet. Resume the payment now, or close this and tap Complete payment — an errand left unpaid for ${UNPAID_CHECKOUT_WINDOW_MINUTES} minutes is cancelled. If you did finish paying, it updates by itself.`;

type ProgressProps = ComponentProps<typeof PaymentProgress>;

/**
 * "Complete payment" for a GCash/Maya booking that is still waiting for its
 * payment: reopens the booking's own checkout in the same in-app sheet the
 * create flow uses, then VERIFIES the outcome through the shared payment
 * verifier — never assumes it.
 *
 * Reopening is safe by construction: the checkout is the booking's one-time
 * charge, so a second open resumes it rather than charging twice.
 *
 * The overlay only ever shows an attempt THIS screen started (or resumed), so
 * an unrelated payment rehydrated from storage never pops up over the errand.
 * `onSettled` runs once the verifier has an answer (and when the overlay is
 * closed) so the caller can refetch the booking: a confirmed payment is what
 * releases it to runners.
 */
export function useCompleteBookingPayment(
  booking: Booking | null | undefined,
  opts: { onSettled?: () => void } = {},
): {
  /** The checkout to reopen, or null when there is nothing to pay. */
  checkoutUrl: string | null;
  completePayment: () => Promise<void>;
  /** True from the tap until the checkout sheet hands back control. */
  opening: boolean;
  /** Spread onto <PaymentProgress />. */
  progress: ProgressProps;
} {
  const router = useRouter();
  const beginAttempt = usePaymentStore((s) => s.beginAttempt);
  const setStatus = usePaymentStore((s) => s.setStatus);
  const resolve = usePaymentStore((s) => s.resolve);
  const { attempt, stage, isOffline } = usePaymentVerification();
  const [opening, setOpening] = useState(false);
  // Synchronous double-tap latch: `opening` only lands a render later, and two
  // sheets racing each other is how a payment sheet ends up in the system
  // browser instead.
  const openingRef = useRef(false);
  const ownedAttemptRef = useRef<string | null>(null);
  const onSettledRef = useRef(opts.onSettled);
  onSettledRef.current = opts.onSettled;

  const checkoutUrl = bookingCheckoutUrl(booking);
  const owned =
    !!attempt &&
    attempt.kind === 'booking' &&
    attempt.attemptId === ownedAttemptRef.current &&
    attempt.bookingId === booking?.id;
  const overlayStage = owned && stage && stage !== 'preparing' ? stage : null;

  // Same honest branches as the create flow: a sheet that never opened, or
  // one the customer dismissed, lands on the actionable failure card rather
  // than spinning the verification overlay for 35 seconds.
  const openSheet = useCallback(
    async (url: string) => {
      const outcome = await openCheckoutUrl(url, PAYMENT_RETURN_URL);
      if (outcome === 'failed') {
        setStatus('failed', { failureReason: undefined });
        toast.error("Couldn't open checkout — you weren't charged. Tap Try again to pay.");
        return;
      }
      if (outcome === 'cancelled') {
        setStatus('failed', { failureReason: CHECKOUT_CANCELLED });
        return;
      }
      setStatus('verifying');
    },
    [setStatus],
  );

  const completePayment = useCallback(async () => {
    if (!booking || !checkoutUrl || openingRef.current) return;
    const current = usePaymentStore.getState().attempt;
    const resumable =
      !!current &&
      isAttemptActive(current) &&
      current.kind === 'booking' &&
      current.bookingId === booking.id;
    // One payment at a time. A different payment still being confirmed owns
    // the lock; /payment-complete shows it and its "Got it" releases it.
    if (isAttemptActive(current) && !resumable) {
      toast.info("We're still confirming your last payment — hang tight.", {
        actionLabel: 'Check status',
        onAction: () => router.push('/payment-complete'),
      });
      return;
    }
    const payAttempt = resumable
      ? current!
      : beginAttempt({
          kind: 'booking',
          amount: Number(booking.total_amount) || 0,
          bookingId: booking.id,
        });
    ownedAttemptRef.current = payAttempt.attemptId;
    setStatus('awaiting_gateway', {
      bookingId: booking.id,
      checkoutUrl,
      reference: booking.booking_number,
      failureReason: undefined,
    });
    openingRef.current = true;
    setOpening(true);
    try {
      await openSheet(checkoutUrl);
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  }, [booking, checkoutUrl, beginAttempt, setStatus, openSheet, router]);

  const retry = useCallback(async () => {
    const url = usePaymentStore.getState().attempt?.checkoutUrl;
    if (!url) return;
    setStatus('awaiting_gateway', { failureReason: undefined });
    await openSheet(url);
  }, [openSheet, setStatus]);

  // The verifier reached a verdict: refetch so the screen underneath moves on
  // (a confirmed payment is what sends the errand to runners).
  const verdict = owned && (attempt?.status === 'success' || attempt?.status === 'failed')
    ? attempt?.status
    : null;
  useEffect(() => {
    if (verdict) onSettledRef.current?.();
  }, [verdict]);

  const dismiss = useCallback(() => {
    resolve();
    ownedAttemptRef.current = null;
    onSettledRef.current?.();
  }, [resolve]);

  return {
    checkoutUrl,
    completePayment,
    opening,
    progress: {
      stage: overlayStage,
      offline: isOffline,
      successTitle: 'Payment confirmed',
      successSubtitle:
        booking?.schedule_type === 'scheduled'
          ? "We'll match you with a runner shortly before your scheduled time."
          : "We're finding you a runner now.",
      successCta: 'Continue',
      receipt: attempt
        ? {
            amount: attempt.amount,
            method: attempt.method,
            reference: attempt.reference,
            paidAt: attempt.paidAt,
          }
        : undefined,
      onSuccessDone: dismiss,
      failureMessage:
        attempt?.failureReason === CHECKOUT_CANCELLED
          ? CHECKOUT_CANCELLED_MESSAGE
          : attempt?.failureReason
            ? mapFailureReason(attempt.failureReason).message
            : undefined,
      onRetry: attempt?.checkoutUrl ? retry : undefined,
      retryCta: attempt?.failureReason === CHECKOUT_CANCELLED ? 'Resume payment' : undefined,
      onClose: dismiss,
      onSafeExit: dismiss,
    },
  };
}
