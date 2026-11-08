import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { ActiveBookingCard } from '../ActiveBookingCard';
import { PaymentProgress } from '../../ui/PaymentProgress';
import { useCompleteBookingPayment } from '../../../hooks/useCompleteBookingPayment';
import { useBookingStore } from '../../../stores/bookingStore';
import { rebookDraft } from '../../../utils/rebookDraft';
import { payNowLabel } from './awaitingPayment';
import type { Booking } from '../../../types';

interface AwaitingPaymentCardProps {
  booking: Booking;
  /** Opens the errand (tracking) — the rest of the card's tap target. */
  onOpen: () => void;
  /** Re-read the home errand list once the payment has a verdict. */
  onSettled: () => void;
}

/**
 * The home card for a GCash/Maya errand still waiting for its payment.
 *
 * Its primary action is the payment itself ("Pay ₱95.00"), not "View": that is
 * the one thing the errand needs before anyone is sent. The payment is NOT
 * re-implemented here — it is the same useCompleteBookingPayment the tracking
 * screen and the waiting screen use, which reopens this booking's own one-time
 * checkout (so a second tap resumes it, never charges twice) and verifies the
 * outcome through the shared verifier, with the shared PaymentProgress overlay.
 *
 * With no open checkout to reopen (the server sends checkout_url only while a
 * charge is open) there is nothing to pay from here, so the card falls back to
 * the ordinary one that opens the errand.
 */
export function AwaitingPaymentCard({ booking, onOpen, onSettled }: AwaitingPaymentCardProps) {
  const router = useRouter();
  const clearDraft = useBookingStore((s) => s.clearDraft);
  const updateDraft = useBookingStore((s) => s.updateDraft);
  const setStep = useBookingStore((s) => s.setStep);
  const setActiveBooking = useBookingStore((s) => s.setActiveBooking);

  // The charge was ruled on (declined, expired, refunded) and the server
  // cancels the errand — the overlay then offers "Book again". Same re-seed
  // as the tracking screen's handleRebook: this errand's details, on Review.
  const rebook = useCallback(() => {
    clearDraft();
    updateDraft(rebookDraft(booking));
    setStep(3);
    setActiveBooking(null);
    router.push('/(customer)/book/review');
  }, [booking, clearDraft, updateDraft, setStep, setActiveBooking, router]);

  const { checkoutUrl, completePayment, opening, progress } = useCompleteBookingPayment(
    booking,
    // Refresh Home only once the result is closed: Home re-renders this card
    // from the list it refetches, which unmounted the result overlay a
    // second after it appeared ("Payment confirmed" flashed; "you weren't
    // charged — Book again" vanished with the errand).
    { onSettled, onRebook: rebook, settleOnVerdict: false },
  );

  return (
    <>
      <ActiveBookingCard
        booking={booking}
        onPress={onOpen}
        primaryAction={
          checkoutUrl
            ? {
                label: payNowLabel(booking),
                onPress: () => {
                  void completePayment();
                },
                loading: opening,
                loadingLabel: 'Opening checkout…',
                accessibilityHint: 'Reopens your checkout for this errand',
              }
            : undefined
        }
      />
      <PaymentProgress {...progress} />
    </>
  );
}
