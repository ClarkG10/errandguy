<?php

namespace App\Services;

use App\Enums\PaymentStatus;
use App\Models\Booking;
use App\Models\Payment;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * BookingSettlementService
 *
 * Resolves the two money seams that open when a booking's gateway charge is
 * confirmed paid AT A DIFFERENT TIME than the booking reaches its resting
 * state — i.e. the webhook / status-reconcile settles the charge AFTER the
 * runner already completed the errand, or AFTER the customer already cancelled:
 *
 *   - booking already COMPLETED  → the runner earning that
 *     RunnerErrandController::handleCompletion could not credit (because the
 *     charge was still pending at completion) is BACK-FILLED now (MONEY-1).
 *     Mirrors the existing referral back-fill that already runs on this path.
 *
 *   - booking already CANCELLED  → a charge that landed after cancellation is
 *     auto-REFUNDED (minus the cancellation fee that was actually recorded),
 *     instead of laundering a cancelled booking to `paid` (MONEY-3 / MONEYX-2).
 *
 * Every path is idempotent and race-safe (runner-row / booking-row locks plus
 * the uq_wallet_tx_user_reference_type unique index as the DB backstop), so it
 * is safe to call from every settlement site (invoice.paid webhook,
 * payment.succeeded webhook, and the status-poll reconciler) and to replay.
 */
class BookingSettlementService
{
    /**
     * Call AFTER a booking's gateway charge has just been transitioned to
     * Completed and the booking marked payment_status = 'paid'. No-ops for a
     * booking still in-flight (pending/matched/accepted/…): that settles
     * normally at completion.
     */
    public function settlePaidBooking(?Payment $payment): void
    {
        $booking = $payment?->booking?->fresh();
        if (! $booking) {
            return;
        }

        if ($booking->status === 'cancelled') {
            $this->refundChargeOnCancelledBooking($booking, $payment);
            return;
        }

        if ($booking->status === 'completed') {
            $this->backfillRunnerEarning($booking);

            // Re-attempt the first-errand referral reward on THIS settlement
            // path too. The webhook handlers call rewardReferralIfEligible
            // separately, but reconcileBookingPayment (the status-poll fallback
            // used when a webhook is never delivered) reaches settlement ONLY
            // through here — so without this, a referee whose qualifying charge
            // settles via the poll would never have their (or the referrer's)
            // bonus granted. reward() locks the referral row and no-ops if it
            // was already rewarded, so the webhook path calling both is safe.
            if ($booking->customer_id) {
                try {
                    app(ReferralService::class)->reward($booking->customer_id);
                } catch (\Throwable $e) {
                    Log::warning('Referral reward re-attempt failed during settlement', [
                        'booking_id' => $booking->id,
                        'error' => $e->getMessage(),
                    ]);
                }
            }
        }
    }

    /**
     * The mirror of settlePaidBooking for a charge that will NEVER arrive.
     *
     * An online booking is matched (and can complete) BEFORE its charge is
     * captured — MatchRunnerJob gates on status only and accept() has no payment
     * gate — so a runner can be driving an order the customer never paid for. A
     * failed/expired terminal transition is the moment we learn the money is not
     * coming; without this the booking stays matched/accepted and nothing
     * releases the runner (AutoCancelBookingJob and ReapStrandedBookingsCommand
     * only reap 'pending'/'no_runner'), so the runner completes the errand and is
     * credited nothing.
     *
     * This MUST be called from every terminal path, not just the webhook. The
     * pull-reconciler routinely beats the webhook (the app polls the status
     * endpoint every 3s from the moment checkout opens), and once it terminalizes
     * the charge the later webhook no-ops on canAdvance — so a webhook-only
     * teardown is silently dead exactly when the customer declines in-app.
     *
     * Cancels the still-live, genuinely unpaid booking under a row lock and
     * dispatches BookingCancelled, whose listeners retract outstanding offer cards
     * and push both parties an "Errand cancelled" notice. No refund is involved
     * (nothing was ever captured). Idempotent + race-safe: a booking that already
     * completed, was cancelled, found no runner, or whose charge actually settled
     * on another path (payment_status 'paid' / a Completed payment row) is left
     * untouched — a stale failed/expired delivery must never tear down a paid or
     * finished errand.
     */
    public function cancelUnpaidBooking(?Payment $payment, string $reason): void
    {
        $bookingId = $payment?->booking_id;
        if (! $bookingId) {
            return;
        }

        $cancelled = DB::transaction(function () use ($bookingId, $reason) {
            $booking = Booking::whereKey($bookingId)->lockForUpdate()->first();
            if (! $booking) {
                return null;
            }

            if (in_array($booking->status, ['completed', 'cancelled', 'no_runner'], true)) {
                return null;
            }
            if ($booking->payment_status === 'paid'
                || Payment::where('booking_id', $booking->id)
                    ->where('status', PaymentStatus::Completed->value)
                    ->exists()) {
                return null;
            }

            $booking->update([
                'status' => 'cancelled',
                'cancelled_at' => now(),
                'cancellation_reason' => $reason,
            ]);
            \App\Models\BookingStatusLog::create([
                'booking_id' => $booking->id,
                'status' => 'cancelled',
                'changed_by' => null,
                'note' => $reason,
            ]);
            if ($booking->runner_id) {
                \Illuminate\Support\Facades\Cache::forget("runner_active_booking_id:{$booking->runner_id}");
            }

            return $booking;
        });

        if ($cancelled) {
            // Post-commit: BookingCancelled's listeners retract outstanding offer
            // cards (RetractBroadcastOffers) and push both parties an "Errand
            // cancelled" notice (SendBookingCancelledNotification).
            event(new \App\Events\BookingCancelled($cancelled));
        }
    }

    /**
     * A gateway charge settled on a booking the customer had already cancelled.
     * Return the money (minus whatever cancellation fee was actually recorded at
     * cancel time) to the customer's wallet and move the payment to Refunded —
     * never leave the customer charged for a cancelled errand.
     */
    private function refundChargeOnCancelledBooking(Booking $booking, Payment $payment): void
    {
        DB::transaction(function () use ($booking) {
            $locked = Booking::whereKey($booking->id)->lockForUpdate()->first();
            if (! $locked || $locked->status !== 'cancelled') {
                return;
            }

            // Already refunded (e.g. it was paid at cancel time, or a replayed
            // webhook) — nothing to do.
            if ($locked->payment_status === 'refunded') {
                return;
            }

            $fee = round((float) $locked->cancellation_fee, 2);
            $refundable = round(max(0, (float) $locked->total_amount - $fee), 2);

            if ($refundable > 0) {
                // Idempotent + bonus/withdrawable-split aware; keyed on the
                // booking id (same key the lifecycle cancel refund uses), so a
                // cancel-then-late-settle can never double-credit.
                app(WalletService::class)->refund($locked->customer_id, $refundable, $locked->id);
            }

            Payment::where('booking_id', $locked->id)
                ->where('status', PaymentStatus::Completed->value)
                ->latest()
                ->first()
                ?->transitionTo(
                    PaymentStatus::Refunded,
                    actor: 'settlement',
                    reason: 'Charge settled after cancellation: auto-refund to wallet minus fee',
                    meta: ['cancellation_fee' => $fee, 'refunded_to' => 'wallet'],
                    extra: [
                        'refund_amount' => $refundable,
                        'refunded_at' => now(),
                        'refunded_to' => 'wallet',
                    ],
                );

            $locked->update(['payment_status' => 'refunded']);

            Log::warning('Auto-refunded a charge that settled after cancellation', [
                'booking_id' => $locked->id,
                'booking_number' => $locked->booking_number,
                'refunded' => $refundable,
                'cancellation_fee' => $fee,
            ]);
        });
    }

    /**
     * A gateway charge settled AFTER the runner completed the errand — credit
     * the runner the payout that handleCompletion left uncredited (it saw an
     * unpaid booking at completion time and, correctly, credited nothing).
     *
     * Idempotent: does nothing if the booking was already settled for this
     * runner (an 'earning' credit or a cash 'commission' debit already exists),
     * and only fires for a genuinely gateway-`paid` booking with an assigned
     * runner. The uq_wallet_tx_user_reference_type index is the DB backstop.
     */
    private function backfillRunnerEarning(Booking $booking): void
    {
        if (! $booking->runner_id || $booking->payment_status !== 'paid') {
            return;
        }

        DB::transaction(function () use ($booking) {
            $runner = User::lockForUpdate()->find($booking->runner_id);
            if (! $runner) {
                return;
            }

            $alreadySettled = WalletTransaction::where('user_id', $runner->id)
                ->where('reference_id', $booking->id)
                ->whereIn('type', ['earning', 'commission'])
                ->exists();
            if ($alreadySettled) {
                return;
            }

            $payout = round((float) $booking->runner_payout, 2);
            if ($payout <= 0) {
                return;
            }

            $newBalance = (float) $runner->wallet_balance + $payout;
            WalletTransaction::create([
                'user_id' => $runner->id,
                'type' => 'earning',
                'amount' => $payout,
                'balance_after' => $newBalance,
                'reference_id' => $booking->id,
                'description' => "Earning for errand #{$booking->booking_number} (settled after completion)",
            ]);
            $runner->update(['wallet_balance' => $newBalance]);

            // The completion counter (total_errands / completion_rate) was
            // already bumped when the errand was marked completed; only the
            // earnings figure was left short, so bump just that.
            if ($runner->runnerProfile) {
                $runner->runnerProfile->increment('total_earnings', $payout);
            }

            Log::info('Back-filled runner earning after late settlement', [
                'booking_id' => $booking->id,
                'runner_id' => $runner->id,
                'payout' => $payout,
            ]);
        });
    }
}
