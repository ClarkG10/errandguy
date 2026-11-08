import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { useRouter } from 'expo-router';
import { openCheckoutUrl, PAYMENT_RETURN_URL } from '../utils/browser';
import { bookingCheckoutUrl, UNPAID_CHECKOUT_WINDOW_MINUTES } from '../utils/bookingPayment';
import { mapFailureReason, CHECKOUT_CANCELLED } from '../utils/paymentErrors';
import { usePaymentStore, isAttemptActive, isAttemptTerminal } from '../stores/paymentStore';
import { usePaymentVerification, verifyAttemptOnce } from './usePaymentVerification';
import { toast } from '../stores/toastStore';
import type { PaymentProgress } from '../components/ui/PaymentProgress';
import type { Booking } from '../types';

/** Marks an attempt whose gateway sheet closed with no payment seen yet, so
 *  the failure overlay can offer "Resume payment" with honest copy instead of
 *  the generic "we couldn't confirm this payment". Lives in utils/paymentErrors
 *  (the store and the verifier need it too); re-exported for existing callers. */
export { CHECKOUT_CANCELLED };

/** What the failure overlay says after the customer backs out of checkout
 *  and one quick check found no payment yet. It claims no more than that: a
 *  payment made just before closing can still be on its way. The way back is
 *  real: the waiting screen and the errand both carry a "Complete payment"
 *  button that reopens the same checkout. */
export const CHECKOUT_CANCELLED_MESSAGE =
  `We haven't received your payment yet, so no runner has been sent. Resume the payment now, or close this and tap Pay — an errand left unpaid for ${UNPAID_CHECKOUT_WINDOW_MINUTES} minutes is cancelled. If you already paid, this updates by itself.`;

/**
 * The customer closed the GCash/Maya sheet. That alone doesn't mean unpaid —
 * iOS reports a cancel when the sheet is dismissed after paying but before the
 * redirect, and on Android coming back from the GCash app counts as a close —
 * so ask the server once, briefly (never the 35-second spinner). Paid, or ruled
 * on: that verdict stands. Otherwise land on the resumable "not received yet"
 * card, which the verifier keeps checking (slowly) until the server rules — so
 * a payment that confirms later still turns into the receipt.
 */
export async function settleClosedCheckout(): Promise<void> {
  if (await verifyAttemptOnce()) return;
  // The poll may have landed a verdict in the instant since; never overwrite it.
  const { attempt, setStatus } = usePaymentStore.getState();
  if (!attempt || isAttemptTerminal(attempt)) return;
  setStatus('failed', { failureReason: CHECKOUT_CANCELLED });
}

/**
 * What the failure overlay offers next for a booking's GCash/Maya payment.
 *
 *  • resume — the customer closed checkout before paying. The charge is still
 *    open, so reopening it is the way forward ("Resume payment").
 *  • retry  — checkout never opened at all (no verdict from anyone), so the
 *    charge is untouched and reopening it is safe ("Try again").
 *  • rebook — the server gave a verdict: the charge was declined, expired or
 *    cancelled (the server then cancels the unpaid errand), or it went through
 *    after the errand was already cancelled and was refunded to the wallet.
 *    The checkout is dead either way — "Try again" would reopen a charge that
 *    can never succeed — so the honest next step is a new booking.
 */
export type BookingPaymentRecovery = 'resume' | 'retry' | 'rebook';

export interface BookingPaymentFailure {
  title: string;
  message: string;
  recovery: BookingPaymentRecovery;
}

/** Turn a booking payment attempt's failure reason into overlay copy + the one next step. */
export function bookingPaymentFailure(reason?: string | null): BookingPaymentFailure {
  if (reason === CHECKOUT_CANCELLED) {
    return { title: 'Payment not received yet', message: CHECKOUT_CANCELLED_MESSAGE, recovery: 'resume' };
  }
  if (!reason) {
    return {
      title: "Checkout didn't open",
      message: "We couldn't open checkout, so you weren't charged. Try again to pay.",
      recovery: 'retry',
    };
  }
  const base = mapFailureReason(reason);
  if (/refund/i.test(reason)) {
    return {
      title: base.title,
      message:
        'Your payment went through after the errand was cancelled, so it was returned to your ErrandGuy wallet.',
      recovery: 'rebook',
    };
  }
  const lead =
    base.title === 'Insufficient funds'
      ? "There wasn't enough balance to pay for this errand, so it was cancelled."
      : base.title === 'Payment expired'
        ? 'The payment window ran out before it went through, so this errand was cancelled.'
        : base.title === 'Payment declined'
          ? 'Your bank or provider declined this payment, so this errand was cancelled.'
          : base.title === 'Payment cancelled'
            ? 'This payment was cancelled, so the errand was cancelled too.'
            : "This payment didn't go through, so the errand was cancelled.";
  return {
    title: base.title,
    message: `${lead} You weren't charged — book it again to pay another way.`,
    recovery: 'rebook',
  };
}

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
 * releases it to runners. `onRebook` is the screen's "Book again", offered when
 * the charge itself is over (see bookingPaymentFailure).
 */
export function useCompleteBookingPayment(
  booking: Booking | null | undefined,
  opts: { onSettled?: () => void; onRebook?: () => void } = {},
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
  const onRebookRef = useRef(opts.onRebook);
  onRebookRef.current = opts.onRebook;
  const canRebook = !!opts.onRebook;

  const checkoutUrl = bookingCheckoutUrl(booking);
  const owned =
    !!attempt &&
    attempt.kind === 'booking' &&
    attempt.attemptId === ownedAttemptRef.current &&
    attempt.bookingId === booking?.id;
  const overlayStage = owned && stage && stage !== 'preparing' ? stage : null;

  // Same honest branches as the create flow: a sheet that never opened lands
  // on the actionable failure card, and one the customer dismissed gets one
  // quick check first, rather than spinning the verification overlay for 35
  // seconds.
  const openSheet = useCallback(
    async (url: string) => {
      const outcome = await openCheckoutUrl(url, PAYMENT_RETURN_URL);
      if (outcome === 'failed') {
        setStatus('failed', { failureReason: undefined });
        toast.error("Couldn't open checkout — you weren't charged. Tap Try again to pay.");
        return;
      }
      if (outcome === 'cancelled') {
        await settleClosedCheckout();
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

  // "Book again" leaves for Review, so no refetch: a late re-read would put
  // the dead booking back in the store the rebook just cleared.
  const rebook = useCallback(() => {
    resolve();
    ownedAttemptRef.current = null;
    onRebookRef.current?.();
  }, [resolve]);

  const failure =
    owned && attempt?.status === 'failed' ? bookingPaymentFailure(attempt.failureReason) : null;
  const offersRebook = failure?.recovery === 'rebook';

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
      failureTitle: failure?.title,
      failureMessage: failure?.message,
      // Reopening the checkout only while the charge is still alive; once the
      // server has ruled on it, the errand is cancelled and Book again leads.
      onRetry: offersRebook
        ? canRebook
          ? rebook
          : undefined
        : attempt?.checkoutUrl
          ? retry
          : undefined,
      retryCta: offersRebook
        ? 'Book again'
        : failure?.recovery === 'resume'
          ? 'Resume payment'
          : undefined,
      onClose: dismiss,
      onSafeExit: dismiss,
    },
  };
}
