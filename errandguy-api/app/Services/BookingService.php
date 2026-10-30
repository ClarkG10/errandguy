<?php

namespace App\Services;

use App\Enums\BookingStatus;
use App\Enums\PaymentStatus;
use App\Events\BookingCancelled;
use App\Events\BookingStatusChanged;
use App\Exceptions\BookingStateException;
use App\Jobs\MatchRunnerJob;
use App\Jobs\SendPushJob;
use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\Payment;
use App\Models\SystemConfig;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class BookingService
{
    /** Matching for a scheduled errand opens this many minutes before its time… */
    public const SCHEDULED_MATCH_LEAD_MINUTES = 15;

    /** …and keeps looking until this many minutes after it. */
    public const SCHEDULED_MATCH_GRACE_MINUTES = 15;

    public function __construct(
        private PricingService $pricingService,
    ) {}

    /**
     * Generate a booking number in format EG-YYYYMMDD-XXXXXX.
     *
     * The exists()-check loop is not a hard guarantee — there is still a
     * check-then-insert window where two same-millisecond creates could pick the
     * same suffix and the second insert would hit the unique index. Widening the
     * suffix from 4 to 6 chars takes the same-day collision space from ~1.7M to
     * ~2.2B, so that residual race is now ~1300x rarer (effectively never for
     * this app's volume). The value is an opaque display string (the clients do
     * not parse its structure), so the extra length is safe.
     */
    public function generateBookingNumber(): string
    {
        do {
            $number = 'EG-' . now()->format('Ymd') . '-' . strtoupper(Str::random(6));
        } while (Booking::where('booking_number', $number)->exists());

        return $number;
    }

    /**
     * The instant the server stops honouring a matched runner's accept:
     * matched_at + `matched_acceptance_timeout_seconds`. This is the exact
     * cutoff {@see \App\Jobs\ExpireStaleMatchesJob} enforces (it re-matches a
     * `matched` fixed booking whose matched_at is older than that window), so
     * the runner's offer countdown must be anchored here rather than guessed
     * client-side. Shared by BookingResource (`accept_deadline`) and
     * MatchRunnerJob's offer push so the two can never drift.
     *
     * Returns an ISO8601 string, or null when the booking was never matched.
     */
    public static function matchAcceptDeadline(mixed $matchedAt): ?string
    {
        if (! $matchedAt) {
            return null;
        }

        $seconds = (int) \App\Models\SystemConfig::getValue('matched_acceptance_timeout_seconds', '90');

        return \Illuminate\Support\Carbon::parse($matchedAt)
            ->addSeconds(max(1, $seconds))
            ->toIso8601String();
    }

    /**
     * Why a customer-initiated retry-match would be refused for this booking,
     * or null when it is eligible. Single source of truth shared by
     * BookingController::retryMatch (which re-evaluates it under a row lock),
     * BookingResource's advisory `can_retry_match` flag and the staff
     * "Re-run matching" action, so none of them can offer or allow a retry the
     * others would refuse.
     *
     *  - 'conflict'  : already matched / assigned / not in a retryable state
     *  - 'refunded'  : money was already returned (or never collected for a
     *                  non-cash charge) — reviving it would run the errand for
     *                  free. The customer must rebook instead (BOOK-1).
     *  - 'scheduled' : a scheduled errand whose matching window has not opened
     *                  yet — searching now would send a runner hours early.
     */
    public static function retryBlockReason(Booking $booking): ?string
    {
        if ($booking->runner_id !== null
            || ! in_array($booking->status, ['pending', 'no_runner', 'cancelled'], true)) {
            return 'conflict';
        }

        if (self::moneyReturned($booking)) {
            return 'refunded';
        }

        return self::matchingOpensAt($booking)->isFuture() ? 'scheduled' : null;
    }

    /**
     * True when the customer's money for this errand has gone back to them (or
     * a non-cash charge never landed). Running it after that means the runner
     * is paid by the platform for an errand nobody paid for.
     */
    public static function moneyReturned(Booking $booking): bool
    {
        return $booking->payment_status === 'refunded'
            || ($booking->payment_method !== 'cash'
                && in_array($booking->payment_status, ['failed', 'expired'], true));
    }

    public static function isScheduled(Booking $booking): bool
    {
        return $booking->schedule_type === 'scheduled' && $booking->scheduled_at !== null;
    }

    /**
     * The earliest moment matching may run: SCHEDULED_MATCH_LEAD_MINUTES before
     * a scheduled errand's time (so a runner isn't sent to the pickup hours
     * early), or creation for everything else.
     */
    public static function matchingOpensAt(Booking $booking): Carbon
    {
        if (self::isScheduled($booking)) {
            return Carbon::parse($booking->scheduled_at)->subMinutes(self::SCHEDULED_MATCH_LEAD_MINUTES);
        }

        return Carbon::parse($booking->created_at ?? now());
    }

    /**
     * When matching gives up and the errand ends as "no runner" (and is
     * refunded): SCHEDULED_MATCH_GRACE_MINUTES after a scheduled errand's time,
     * or `auto_cancel_timeout_minutes` after an immediate one was placed.
     *
     * Shared by MatchRunnerJob's search ladder, AutoCancelBookingJob and booking
     * creation, so the search, the auto-cancel and the refund all agree on when
     * the errand's time is up.
     */
    public static function matchingDeadline(Booking $booking): Carbon
    {
        if (self::isScheduled($booking)) {
            return Carbon::parse($booking->scheduled_at)->addMinutes(self::SCHEDULED_MATCH_GRACE_MINUTES);
        }

        $timeoutMinutes = (int) SystemConfig::getValue('auto_cancel_timeout_minutes', '30');

        return Carbon::parse($booking->created_at ?? now())->addMinutes($timeoutMinutes);
    }

    /**
     * Log a booking status change.
     */
    public function logStatusChange(
        string $bookingId,
        string $status,
        ?string $changedBy = null,
        ?string $note = null,
        ?float $lat = null,
        ?float $lng = null
    ): BookingStatusLog {
        return BookingStatusLog::create([
            'booking_id' => $bookingId,
            'status' => $status,
            'changed_by' => $changedBy,
            'note' => $note,
            'lat' => $lat,
            'lng' => $lng,
        ]);
    }

    /**
     * Check if a booking can be cancelled based on current status.
     */
    public function isCancellable(Booking $booking): bool
    {
        return in_array($booking->status, ['pending', 'matched', 'accepted']);
    }

    /**
     * Admin/platform-initiated cancel — the single money-safe path behind the
     * Filament BookingResource cancel action (the sole admin surface).
     *
     * Because an admin/platform cancel is not the customer's fault, a paid
     * booking is refunded IN FULL with no cancellation fee (unlike the
     * customer-initiated cancel), via the shared refundUnfulfilled primitive.
     *
     * @throws BookingStateException when the booking is already finalized.
     */
    public function adminCancel(string $bookingId, string $adminId, string $reason): void
    {
        // The finalized check and the write happen in ONE transaction under the
        // row lock.
        //
        // They used to be an unlocked read followed by an id-only UPDATE, so an
        // admin cancelling while the assigned runner was completing would read
        // 'delivered' (not finalized), block on the lock the runner's completion
        // transaction held, and then land ON TOP of it. The result: an errand the
        // runner had finished flipped 'completed' → 'cancelled' AFTER they were
        // credited their earning — so their history showed a job they completed
        // as cancelled, their completion_rate counted it as a cancellation on the
        // next recompute, and refundUnfulfilled then saw payment_status still
        // 'paid' and refunded the whole fare for an errand that was delivered.
        // Money out on both sides of the same errand.
        //
        // Locking makes the runner's completion win the race, and the admin gets
        // the honest "Booking already finalized" that Filament already surfaces.
        $booking = DB::transaction(function () use ($bookingId, $adminId, $reason) {
            $locked = Booking::whereKey($bookingId)->lockForUpdate()->firstOrFail();

            if (BookingStatus::isFinalized($locked->status)) {
                throw new BookingStateException('Booking already finalized');
            }

            $locked->update([
                'status' => 'cancelled',
                'cancelled_at' => now(),
                // cancelled_by is a uuid column — record the acting admin's real id.
                'cancelled_by' => $adminId,
                'cancellation_reason' => $reason,
            ]);

            return $locked;
        });

        // Don't leave the assigned runner's GPS pings tagged to the cancelled
        // booking for the next ~30s (per-runner active-booking cache).
        if ($booking->runner_id) {
            Cache::forget("runner_active_booking_id:{$booking->runner_id}");
        }

        // Notify + broadcast the cancellation. BookingCancelled keeps its push
        // listener (the customer should learn an admin cancelled their booking)
        // and now also broadcasts `booking.status` to the booking channel, so
        // both apps drop out of the active trip live — the admin-cancel path
        // previously dispatched no event at all.
        event(new BookingCancelled($booking));

        $this->refundUnfulfilled($booking->id, 'Admin cancelled the booking');
    }

    /**
     * Staff re-run matching for a STUCK errand (no runner assigned yet). Only
     * valid while the booking is `no_runner` or still `pending` — a booking
     * already matched/accepted/in-progress must never be pulled back to pending
     * here (that would strand the assigned runner mid-errand; staff use
     * adminReturnToMatching for that).
     *
     * Refused, like the customer's own "try again", when the money was already
     * returned (the errand would run for free) or when a scheduled errand's
     * matching window has not opened yet (a runner would be sent hours early).
     * Starts a fresh round of offers; runners who already turned it down are
     * still skipped. An optional wider radius helps when the default search
     * found nobody nearby.
     *
     * @throws BookingStateException with a staff-readable reason.
     */
    public function adminRematch(string $bookingId, ?float $radiusKm = null): void
    {
        DB::transaction(function () use ($bookingId, $radiusKm) {
            $locked = Booking::whereKey($bookingId)->lockForUpdate()->firstOrFail();

            if ($locked->runner_id !== null || ! in_array($locked->status, ['no_runner', 'pending'], true)) {
                throw new BookingStateException(
                    'Only an unmatched errand (no runner assigned yet) can be re-matched.'
                );
            }

            match (self::retryBlockReason($locked)) {
                'refunded' => throw new BookingStateException(
                    'This errand’s payment was refunded or never collected, so re-running matching '
                    .'would run it for free. Ask the customer to book again.'
                ),
                'scheduled' => throw new BookingStateException(
                    'This errand is scheduled for '.self::businessTime($locked->scheduled_at)
                    .'. Matching starts on its own at '.self::businessTime(self::matchingOpensAt($locked)).'.'
                ),
                default => null,
            };

            // Back to pending so MatchRunnerJob — which no-ops on any other
            // status — picks it up again.
            $locked->update(['status' => 'pending', 'offer_count' => 0]);

            BookingStatusLog::create([
                'booking_id' => $locked->id,
                'status' => 'pending',
                // changed_by is a FK to users; an admin_users id would violate it, so
                // record this as a system change (null). The acting admin is captured
                // in the Filament audit log (AdminNotify 'booking.rematch').
                'changed_by' => null,
                'note' => $radiusKm
                    ? "Admin re-ran matching (radius {$radiusKm} km)"
                    : 'Admin re-ran matching',
            ]);
        });

        MatchRunnerJob::dispatch($bookingId, $radiusKm);
    }

    /**
     * Staff take an accepted-but-unfinished errand off its runner (they went
     * dark, their vehicle broke down, the customer asked) and offer it to
     * someone else. The removed runner is told, never offered it again, and the
     * customer is told a new runner is on the way. Matching starts a fresh round
     * of offers right away — or at the window opening for a scheduled errand
     * that is not due yet.
     *
     * Refused when the money for it was already returned, so a rescue can never
     * set up an errand that runs for free.
     *
     * @throws BookingStateException with a staff-readable reason.
     */
    public function adminReturnToMatching(string $bookingId, string $reason): void
    {
        [$booking, $runnerId, $oldStatus] = DB::transaction(function () use ($bookingId, $reason) {
            $locked = Booking::whereKey($bookingId)->lockForUpdate()->firstOrFail();

            if ($locked->runner_id === null || ! in_array($locked->status, BookingStatus::IN_PROGRESS, true)) {
                throw new BookingStateException(
                    'Only an errand a runner has accepted and not finished can be returned to matching.'
                );
            }

            if (self::moneyReturned($locked)) {
                throw new BookingStateException(
                    'This errand’s payment was refunded or never collected, so it can’t be offered to another '
                    .'runner. Cancel it instead.'
                );
            }

            $runnerId = (string) $locked->runner_id;
            $oldStatus = $locked->status;

            $locked->update([
                'status' => 'pending',
                'runner_id' => null,
                'matched_at' => null,
                'accepted_at' => null,
                'offered_runner_ids' => $locked->withOfferedRunner($runnerId),
                'offer_count' => 0,
            ]);

            BookingStatusLog::create([
                'booking_id' => $locked->id,
                'status' => 'pending',
                // A system change (see adminRematch); the admin is in the audit log.
                'changed_by' => null,
                'note' => "Staff returned the errand to matching: {$reason}",
            ]);

            return [$locked, $runnerId, $oldStatus];
        });

        // Stop tagging the removed runner's GPS pings to this errand.
        Cache::forget("runner_active_booking_id:{$runnerId}");

        // Live update for both apps (`pending` has no push template, so this is
        // broadcast-only — the two pushes below carry the explanation).
        event(new BookingStatusChanged($booking, $oldStatus, 'pending'));

        $number = $booking->booking_number ?? $booking->id;
        SendPushJob::dispatch(
            $runnerId,
            'Errand reassigned',
            "Our support team took errand #{$number} off you, so you don’t need to continue it.",
            ['type' => 'system', 'booking_id' => $booking->id, 'reason' => 'returned_to_matching'],
        );
        SendPushJob::dispatch(
            $booking->customer_id,
            'Finding you a new runner',
            "Your runner can’t finish errand #{$number}, so we’re finding you someone else. You don’t need to do anything.",
            ['type' => 'booking_update', 'booking_id' => $booking->id, 'status' => 'pending'],
        );

        $opensAt = self::matchingOpensAt($booking);
        $match = MatchRunnerJob::dispatch($booking->id, null, $runnerId);
        if ($opensAt->isFuture()) {
            $match->delay($opensAt);
        }
    }

    /**
     * Staff mark an accepted-but-unfinished errand completed (the runner did the
     * work but can't finish it in the app). Settles EXACTLY like the runner's
     * own completion — the same booking lock, the same once-only checks, and the
     * same settlement code (BookingSettlementService::settleCompletion): the
     * runner is paid, the payment is recorded, and both sides get the usual
     * "Errand completed" notice.
     *
     * @throws BookingStateException with a staff-readable reason.
     */
    public function adminMarkCompleted(string $bookingId, string $adminId, string $reason): void
    {
        [$booking, $oldStatus] = DB::transaction(function () use ($bookingId, $adminId, $reason) {
            $locked = Booking::whereKey($bookingId)->lockForUpdate()->firstOrFail();

            if ($locked->runner_id === null || ! in_array($locked->status, BookingStatus::IN_PROGRESS, true)) {
                throw new BookingStateException(
                    'Only an errand a runner has accepted and not finished can be marked completed.'
                );
            }

            $runner = User::find($locked->runner_id);
            if (! $runner) {
                throw new BookingStateException('The runner on this errand no longer exists, so it can’t be settled.');
            }

            $oldStatus = $locked->status;

            $locked->update(['status' => 'completed', 'completed_at' => now()]);

            BookingStatusLog::create([
                'booking_id' => $locked->id,
                'status' => 'completed',
                'changed_by' => null,
                'note' => "Marked completed by staff: {$reason}",
            ]);

            $locked->refresh();
            app(BookingSettlementService::class)->settleCompletion($locked, $runner, "admin:{$adminId}");

            return [$locked, $oldStatus];
        });

        Cache::forget("runner_active_booking_id:{$booking->runner_id}");

        // Same post-commit event as the runner's completion: customer + runner
        // notices, the referral reward, live status for both apps.
        event(new BookingStatusChanged($booking, $oldStatus, 'completed'));
    }

    /** "Nov 3, 2:30 PM" in the business timezone, for staff-facing messages. */
    private static function businessTime(mixed $at): string
    {
        return Carbon::parse($at)
            ->timezone(config('app.business_timezone', 'Asia/Manila'))
            ->format('M j, g:i A');
    }

    /**
     * Full-refund-no-fee primitive: return the entire collected amount when a
     * booking ends through no fault of the customer — no runner was ever
     * matched (MatchRunnerJob → no_runner / AutoCancelBookingJob) OR an
     * admin/platform cancelled it. Unlike a customer-initiated
     * cancellation, NO cancellation fee is withheld.
     *
     * Idempotent + race-safe: locks the booking and only acts while
     * payment_status is 'paid', so a repeat call (both no-runner paths can fire
     * for the same booking) is a no-op. Relies on the idempotent
     * WalletService::refund + the Payment state machine. Refunds to the wallet,
     * matching the cancellation refund path (gateway reversal is not wired).
     * Cash / unpaid / already-refunded bookings collected nothing to return.
     */
    public function refundUnfulfilled(string $bookingId, string $reason): void
    {
        DB::transaction(function () use ($bookingId, $reason) {
            $locked = Booking::whereKey($bookingId)->lockForUpdate()->first();
            if (! $locked) {
                return;
            }

            // Never refund a COMPLETED errand. Belt-and-braces behind
            // adminCancel's row lock: this method is only ever called for a
            // booking that will not be fulfilled, so a 'completed' row here
            // means a caller raced a completion — and refunding the full fare
            // for work that was actually delivered is money out with nothing
            // to reclaim it.
            if ($locked->status === 'completed') {
                Log::warning('refundUnfulfilled called on a COMPLETED booking — refusing', [
                    'booking_id' => $locked->id,
                    'reason' => $reason,
                ]);

                return;
            }

            // Nothing was collected (cash/unpaid), or a racing call already
            // refunded it — either way there is nothing to return.
            if ($locked->payment_status !== 'paid') {
                return;
            }

            $refundable = round((float) $locked->total_amount, 2);
            if ($refundable > 0) {
                app(WalletService::class)->refund($locked->customer_id, $refundable, $locked->id);

                Payment::where('booking_id', $locked->id)
                    ->where('status', 'completed')
                    ->latest()
                    ->first()
                    ?->transitionTo(
                        PaymentStatus::Refunded,
                        actor: 'system',
                        reason: $reason,
                        meta: ['refunded_to' => 'wallet', 'unfulfilled' => true],
                        extra: [
                            'refund_amount' => $refundable,
                            'refunded_at' => now(),
                            // Honest record: money went to the wallet, not reversed to source.
                            'refunded_to' => 'wallet',
                        ],
                    );
            }

            $locked->update(['payment_status' => 'refunded']);
        });
    }

}
