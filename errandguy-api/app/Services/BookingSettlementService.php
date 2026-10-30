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
 * Settles an errand's money at completion ({@see self::settleCompletion()} —
 * the one path behind both the runner's own "completed" tap and staff "Mark
 * completed"), and resolves the two money seams that open when a booking's
 * gateway charge is confirmed paid AT A DIFFERENT TIME than the booking reaches
 * its resting state — i.e. the webhook / status-reconcile settles the charge
 * AFTER the runner already completed the errand, or AFTER the customer already
 * cancelled:
 *
 *   - booking already COMPLETED  → the runner earning that settleCompletion
 *     could not credit (because the charge was still pending at completion) is
 *     BACK-FILLED now (MONEY-1). Mirrors the existing referral back-fill that
 *     already runs on this path.
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
     * Settle a just-completed errand: settlement, runner stats, payment marking.
     *
     * MUST run inside the transaction that holds the booking's row lock and has
     * just moved it to `completed` (RunnerErrandController::updateStatus and
     * BookingService::adminMarkCompleted), with the booking re-read under that
     * lock so payment_status is current.
     *
     * Settlement is a function of what was ACTUALLY collected — never of the
     * booking status alone (that was the critical money leak):
     *   - paid (wallet/online): the platform holds the funds, so the runner's
     *     payout is credited to their withdrawable wallet.
     *   - cash: the runner collected the full fare in person, so they keep it
     *     and OWE the platform its service fee — recorded as a negative
     *     'commission' entry that nets against their wallet balance (and thus
     *     against future earnings / payout). Their balance may go negative;
     *     that debt is the point.
     *   - unsettled online (expired/failed): nobody collected → credit nothing.
     *
     * @param  string|null  $actor  Who to record on the payment's audit trail;
     *                              the runner unless staff completed it.
     */
    public function settleCompletion(Booking $booking, User $runner, ?string $actor = null): void
    {
        $actor ??= (string) $runner->id;
        $profile = $runner->runnerProfile;
        if (! $profile) {
            return;
        }

        // Self-deal backstop (legacy rows only — accept() blocks new ones): a
        // booking whose customer and runner are the SAME user must never
        // settle, or the platform moves money within a single wallet and lets
        // the user farm earnings/stats. Skip settlement and flag for
        // reconciliation.
        if ((string) $booking->customer_id === (string) $booking->runner_id) {
            Log::critical('Self-dealt booking reached completion; settlement skipped', [
                'booking_id' => $booking->id,
                'user_id' => $booking->customer_id,
            ]);
            return;
        }

        // Idempotency guard: if this booking is already settled for this runner
        // (an 'earning' credit OR a cash 'commission' debit) we must NOT settle
        // again. Runs inside the booking-locked transaction, so it is race-safe;
        // the uq_wallet_tx_user_reference_type index is the DB-level backstop.
        $alreadySettled = WalletTransaction::where('user_id', $runner->id)
            ->where('reference_id', $booking->id)
            ->whereIn('type', ['earning', 'commission'])
            ->exists();

        if ($alreadySettled) {
            $this->markPaymentCompleted($booking->payment, $actor);
            return;
        }

        // Lock the runner row to serialize concurrent balance writes.
        $runner = User::lockForUpdate()->find($runner->id);
        $payoutAmount = (float) $booking->runner_payout;
        $earnedForStats = 0.0;
        $collected = false;

        if ($booking->payment_status === 'paid') {
            // Shared primitive — see WalletService::applyLedgerDelta. This path
            // and the late-settlement back-fill both credit the SAME booking;
            // they used to round it differently.
            app(WalletService::class)->applyLedgerDelta(
                $runner,
                'earning',
                $payoutAmount,
                $booking->id,
                "Earning for errand #{$booking->booking_number}",
            );
            $earnedForStats = $payoutAmount;
            $collected = true;
        } elseif ($booking->payment_method === 'cash') {
            // The runner collected total_amount in cash and keeps runner_payout,
            // so the platform's commission is exactly what's left over:
            //   commission = total_amount − runner_payout
            // This is the true invariant for every booking, including older
            // negotiate-priced ones whose runner_payout was floored to 0 (where
            // service_fee − promo would over-debit the runner). It equals
            // service_fee − promo_discount for a standard booking (so it fixes
            // MONEY-2: charging the full service_fee made the runner eat the
            // platform-funded promo and overstated total_earnings). When the
            // runner collected LESS cash than their payout (an older promo or
            // low offer) commission goes negative and they are correctly
            // CREDITED the shortfall. Promo codes and negotiate pricing are
            // retired, so those cases only appear on bookings made before then.
            $commission = round((float) $booking->total_amount - (float) $booking->runner_payout, 2);
            app(WalletService::class)->applyLedgerDelta(
                $runner,
                'commission',
                -$commission,
                $booking->id,
                "Platform commission for cash errand #{$booking->booking_number}",
            );
            $earnedForStats = $payoutAmount; // earned in cash, in person
            $collected = true;
        }
        // else: unsettled online payment — nothing was collected, credit nothing.

        // Update runner stats
        $newTotalErrands = $profile->total_errands + 1;
        $newTotalEarnings = (float) $profile->total_earnings + $earnedForStats;

        // Recalculate completion rate with a SINGLE conditional-aggregation
        // query — was two separate COUNT(*) round-trips held under the booking
        // + runner row locks, needlessly lengthening lock hold time. Because
        // 'completed' is a strict subset of the {completed,cancelled} assigned
        // set, SUM(CASE ...) equals the old completed()->count() and COUNT(*)
        // equals the old total, so the computed rate is identical.
        // NOTE: 'completed' is hardcoded here rather than reusing the
        // Booking::completed() scope; if that scope ever grows beyond a bare
        // status filter, keep this in sync (guarded by the completion_rate
        // regression test in StatusUpdateTest).
        $stats = $runner->runnerBookings()
            ->whereIn('status', ['completed', 'cancelled'])
            ->toBase()
            ->selectRaw("COUNT(*) as total_assigned, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count")
            ->first();
        $totalAssigned = (int) ($stats->total_assigned ?? 0);
        $completedCount = (int) ($stats->completed_count ?? 0);
        $completionRate = $totalAssigned > 0
            ? round(($completedCount / $totalAssigned) * 100, 2)
            : 100.00;

        $profile->update([
            'total_errands' => $newTotalErrands,
            'total_earnings' => $newTotalEarnings,
            'completion_rate' => $completionRate,
        ]);

        // Only record the payment as settled when money was actually collected
        // (platform-side for paid, in-person cash for cash). An unsettled online
        // charge must NOT be laundered to 'completed'.
        if ($collected) {
            $this->markPaymentCompleted($booking->payment, $actor);
        }
    }

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
     * dispatches BookingCancelled, whose listener pushes both parties an
     * "Errand cancelled" notice. No refund is involved
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
            // Post-commit: BookingCancelled's listener pushes both parties an
            // "Errand cancelled" notice (SendBookingCancelledNotification).
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
     * the runner the payout that settleCompletion left uncredited (it saw an
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

            // One shared primitive with the completion-time credit, so the two
            // paths that can settle the SAME booking can never round it
            // differently or disagree with the ledger's balance_after.
            app(WalletService::class)->applyLedgerDelta(
                $runner,
                'earning',
                $payout,
                $booking->id,
                "Earning for errand #{$booking->booking_number} (settled after completion)",
            );

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

    /**
     * Move the booking's payment to Completed through the audited
     * {@see Payment::transitionTo()} funnel — never a raw
     * ->update(['status' => ...]), which would skip the payment_status_transitions
     * audit row and could launder an illegal failed/expired -> completed move
     * with a fabricated paid_at. No-ops safely when the payment is null, already
     * completed, or cannot legally advance.
     */
    private function markPaymentCompleted(?Payment $payment, string $actorId): void
    {
        if (! $payment) {
            return;
        }

        $current = PaymentStatus::tryFrom((string) $payment->status);
        if ($current && $current->canTransitionTo(PaymentStatus::Completed)) {
            $payment->transitionTo(
                PaymentStatus::Completed,
                actor: $actorId,
                reason: 'Errand completed',
                extra: ['paid_at' => now()],
            );
        }
    }
}
