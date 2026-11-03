<?php

namespace App\Services;

use App\Enums\BookingStatus;
use App\Enums\PaymentStatus;
use App\Events\BookingCancelled;
use App\Events\BookingStatusChanged;
use App\Exceptions\BookingStateException;
use App\Jobs\AutoCancelBookingJob;
use App\Jobs\MatchRunnerJob;
use App\Jobs\SendPushJob;
use App\Models\AdminAlert;
use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\BookingStop;
use App\Models\Payment;
use App\Models\SystemConfig;
use App\Models\User;
use App\Support\CancellationNotice;
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

    /**
     * How long a GCash/Maya errand waits for its payment. Unpaid after this,
     * it is cancelled (no runner was ever involved): see cancelAbandonedPayment.
     */
    public const PAYMENT_WINDOW_MINUTES = 15;

    /**
     * Why an errand whose payment never arrived was cancelled — the
     * cancellation_reason the app shows, for a timed-out checkout and for a
     * declined or expired charge alike.
     */
    public const PAYMENT_NOT_COMPLETED = "Payment wasn't completed, so your errand was cancelled.";

    /** The machine-readable cancellation_code that goes with PAYMENT_NOT_COMPLETED. */
    public const PAYMENT_NOT_COMPLETED_CODE = 'payment_not_completed';

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
     *  - 'unpaid'    : a GCash/Maya errand whose payment never arrived. Matching
     *                  only ever starts once the money is in.
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

        if (self::unpaidOnline($booking)) {
            return 'unpaid';
        }

        return self::matchingOpensAt($booking)->isFuture() ? 'scheduled' : null;
    }

    /**
     * retryBlockReason for the CUSTOMER's own "Search again", plus one more:
     *
     *  - 'searching' : the errand is still pending — its search is running.
     *                  A retry would wipe the round's offer count and skip
     *                  list and restart the window, so a customer tapping
     *                  repeatedly could re-offer it to the runners who just
     *                  let it go and keep it searching indefinitely. The app
     *                  only offers "Search again" once the errand is
     *                  no_runner, so nothing it does is refused.
     *
     * Staff "Re-run matching" (adminRematch) keeps using retryBlockReason: a
     * stuck pending errand is exactly what it is for. Shared by
     * BookingController::retryMatch and BookingResource `can_retry_match`.
     */
    public static function customerRetryBlockReason(Booking $booking): ?string
    {
        return self::retryBlockReason($booking)
            ?? ($booking->status === 'pending' ? 'searching' : null);
    }

    /**
     * True for an errand paid through the gateway (GCash/Maya, or a card or
     * GrabPay errand booked before those were retired). Cash and the wallet
     * settle without it, and so does an older booking with no method recorded.
     */
    public static function paysOnline(Booking $booking): bool
    {
        return $booking->payment_method !== null
            && ! in_array($booking->payment_method, ['cash', 'wallet'], true);
    }

    /**
     * True when a gateway-paid errand's money has not arrived. No runner is
     * searched for until it has: MatchRunnerJob refuses such an errand, and
     * matching for it starts from startMatchingAfterPayment.
     */
    public static function unpaidOnline(Booking $booking): bool
    {
        return self::paysOnline($booking) && $booking->payment_status !== 'paid';
    }

    /**
     * True while a placed GCash/Maya errand waits for the customer to pay:
     * matching hasn't started and the money hasn't arrived. It ends one of two
     * ways — the payment is confirmed and matching starts
     * (startMatchingAfterPayment), or PAYMENT_WINDOW_MINUTES pass and the
     * errand is cancelled (cancelAbandonedPayment). The no-runner auto-cancel
     * leaves it alone. The app offers to resume the payment meanwhile
     * (BookingResource `awaiting_payment` / `checkout_url`).
     */
    public static function awaitingPayment(Booking $booking): bool
    {
        return $booking->status === 'pending'
            && $booking->matching_started_at === null
            && self::unpaidOnline($booking);
    }

    /** When an unpaid GCash/Maya errand is given up on: PAYMENT_WINDOW_MINUTES after it was placed. */
    public static function paymentDeadline(Booking $booking): Carbon
    {
        return Carbon::parse($booking->created_at ?? now())->addMinutes(self::PAYMENT_WINDOW_MINUTES);
    }

    /**
     * The customer's own way back into an unfinished payment: the GCash/Maya
     * authorization URL of the errand's open charge, or null when there is
     * none (no open charge, or the gateway gave us no URL).
     */
    public static function pendingCheckoutUrl(Booking $booking): ?string
    {
        $payment = Payment::where('booking_id', $booking->id)
            ->whereIn('status', [PaymentStatus::Pending->value, PaymentStatus::Processing->value])
            ->whereNotNull('gateway_tx_id')
            ->latest('created_at')
            ->first();

        if (! $payment) {
            return null;
        }

        $response = (array) $payment->gateway_response;

        // A card errand booked before cards were retired paid on a hosted invoice.
        return PaymentService::extractActionUrl($response) ?? ($response['invoice_url'] ?? null);
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
     * or `auto_cancel_timeout_minutes` after matching started on an immediate
     * one. It counts from matching_started_at, not creation, so a GCash/Maya
     * errand doesn't lose search time to a slow payment (an errand whose
     * matching has not started yet counts from creation).
     *
     * Shared by MatchRunnerJob's search ladder, AutoCancelBookingJob and the
     * stranded-booking reaper, so the search, the auto-cancel and the refund
     * all agree on when the errand's time is up.
     */
    public static function matchingDeadline(Booking $booking): Carbon
    {
        if (self::isScheduled($booking)) {
            return Carbon::parse($booking->scheduled_at)->addMinutes(self::SCHEDULED_MATCH_GRACE_MINUTES);
        }

        return Carbon::parse($booking->matching_started_at ?? $booking->created_at ?? now())
            ->addMinutes(self::matchingTimeoutMinutes());
    }

    /** How long an errand booked for now is searched for: `auto_cancel_timeout_minutes`. */
    public static function matchingTimeoutMinutes(): int
    {
        return (int) SystemConfig::getValue('auto_cancel_timeout_minutes', '30');
    }

    /**
     * The bookkeeping for a NEW round of matching — a customer's "try again",
     * a staff re-run, a staff "Return to matching" — merged into the caller's
     * update while it holds the booking's row lock.
     *
     *  - The search window starts again from now, so a rescue that comes long
     *    after the errand was placed gets a full search instead of one sweep
     *    before the auto-cancel (and the stranded-booking reaper) end it.
     *  - A scheduled errand whose window has run out (or nearly) would get no
     *    real search time, so the new round runs like an errand booked for now.
     *    One whose window hasn't opened yet keeps waiting for it (and the
     *    scheduled-matching sweep starts it if its delayed task is lost).
     *  - offered_runner_ids is cleared: a runner who merely missed a 90-second
     *    offer can be offered it again. Only $excludedRunnerIds (the runner
     *    staff took it off) stay skipped. Within the round the skip list and
     *    the offer cap work as before.
     *
     * The caller arms the auto-cancel (armAutoCancel) and dispatches the search
     * after commit.
     *
     * @param  list<string>  $excludedRunnerIds
     * @return array<string, mixed>
     */
    public static function freshRound(Booking $booking, array $excludedRunnerIds = []): array
    {
        $round = [
            'offer_count' => 0,
            'offered_runner_ids' => $excludedRunnerIds === [] ? null : array_values(array_unique($excludedRunnerIds)),
        ];

        if (self::matchingOpensAt($booking)->isFuture()) {
            return [...$round, 'matching_started_at' => null];
        }

        $round['matching_started_at'] = now();

        if (self::isScheduled($booking)
            && self::matchingDeadline($booking)->lt(now()->addMinutes(self::matchingTimeoutMinutes()))) {
            $round['schedule_type'] = 'now';
        }

        return $round;
    }

    /**
     * Arm the no-runner auto-cancel for the end of the booking's current
     * matching window. It no-ops once the booking leaves pending, and re-arms
     * itself when the window was extended meanwhile.
     */
    public static function armAutoCancel(Booking $booking): void
    {
        AutoCancelBookingJob::dispatch($booking->id)->delay(self::matchingDeadline($booking));
    }

    /**
     * Start looking for a runner: arm the no-runner auto-cancel for the end of
     * the matching window, then search — right away (inside this request, so
     * the customer doesn't depend on a healthy queue worker), or from the
     * window opening for a scheduled errand that isn't due yet.
     *
     * The caller decides the errand may be matched (paid, or cash/wallet).
     * Shared by booking creation and startMatchingAfterPayment.
     */
    public static function beginMatching(Booking $booking): void
    {
        $matchAt = self::matchingOpensAt($booking);

        if ($matchAt->isFuture()) {
            // The sweep in errandguy:start-due-scheduled-matching restarts it
            // if this delayed task is ever lost.
            self::armAutoCancel($booking);
            MatchRunnerJob::dispatch($booking->id)->delay($matchAt);

            return;
        }

        // Matching starts now, so the search window (and the auto-cancel armed
        // for its end) counts from this moment.
        if ($booking->matching_started_at === null) {
            Booking::whereKey($booking->id)->whereNull('matching_started_at')->update(['matching_started_at' => now()]);
            $booking->refresh();
        }

        // Armed BEFORE the search: it no-ops once the booking leaves
        // 'pending', and if the search below dies the errand still ends (and
        // is refunded) on time.
        self::armAutoCancel($booking);

        // A failure here (a deadlock under load, a listener throwing) must not
        // fail the caller: by now the errand is paid for, and a booking request
        // that errored would be tapped again and charged twice. The search is
        // handed to the queue instead (MatchRunnerJob retries with backoff); if
        // it never finds anyone, the auto-cancel above refunds the errand.
        try {
            MatchRunnerJob::dispatchSync($booking->id);
        } catch (\Throwable $e) {
            Log::error('Instant matching failed; retrying on the queue', [
                'booking_number' => $booking->booking_number,
                'error' => $e->getMessage(),
            ]);
            MatchRunnerJob::dispatch($booking->id)->delay(now()->addSeconds(10));
        }
    }

    /**
     * Start matching for a GCash/Maya errand whose payment has just been
     * confirmed. A gateway-paid errand is never offered to a runner before its
     * money arrives, so this is where its search begins — called from every
     * place a payment is confirmed (the Xendit webhook and the gateway pull
     * behind the app's status check and the 15-minute reconcile sweep, all via
     * BookingSettlementService::settlePaidBooking, plus the status check and
     * the sweep themselves as a backstop).
     *
     * Starts exactly once however many of them race: the booking is locked and
     * claimed by stamping matching_started_at, and only an errand that is still
     * pending with no runner, now paid, gateway-paid and never matched is
     * claimed. A scheduled errand that isn't due yet is left alone —
     * errandguy:start-due-scheduled-matching starts it at its time.
     *
     * @return bool true iff this call started matching.
     */
    public function startMatchingAfterPayment(string $bookingId): bool
    {
        $startable = fn (?Booking $booking): bool => $booking !== null
            && $booking->status === 'pending'
            && $booking->runner_id === null
            && $booking->payment_status === 'paid'
            && $booking->matching_started_at === null
            && self::paysOnline($booking)
            && ! self::matchingOpensAt($booking)->isFuture();

        // Cheap unlocked look first: the status check calls this on every poll
        // of a confirmed payment, and almost always there is nothing to start.
        if (! $startable(Booking::find($bookingId))) {
            return false;
        }

        $claimed = DB::transaction(function () use ($bookingId, $startable) {
            $locked = Booking::whereKey($bookingId)->lockForUpdate()->first();

            if (! $startable($locked)) {
                return null;
            }

            $locked->update(['matching_started_at' => now()]);

            return $locked;
        });

        if (! $claimed) {
            return false;
        }

        Log::info('Payment confirmed; matching started', ['booking_id' => $claimed->id]);
        self::beginMatching($claimed);

        return true;
    }

    /**
     * Cancel a GCash/Maya errand whose payment never arrived within
     * PAYMENT_WINDOW_MINUTES. No runner was ever involved (none is searched for
     * before the money is in), so nothing else needs undoing; the customer is
     * told the payment wasn't completed.
     *
     * The charge itself is left open: Xendit's Payment Requests API offers no
     * way to void a GCash/Maya charge. If the customer still pays it, the
     * payment lands on a cancelled errand and is refunded in full to their
     * ErrandGuy wallet (BookingSettlementService::settlePaidBooking).
     *
     * Locked and re-checked, so a payment confirmed at the same moment wins
     * (the errand is paid, so it is matched instead).
     *
     * @return bool true iff this call cancelled the errand.
     */
    public function cancelAbandonedPayment(string $bookingId): bool
    {
        $cancelled = DB::transaction(function () use ($bookingId) {
            $locked = Booking::whereKey($bookingId)->lockForUpdate()->first();

            if (! $locked
                || ! self::awaitingPayment($locked)
                || $locked->runner_id !== null
                || self::paymentDeadline($locked)->isFuture()) {
                return null;
            }

            // The money arrived but the booking's flag isn't set yet.
            if (Payment::where('booking_id', $locked->id)->where('status', PaymentStatus::Completed->value)->exists()) {
                return null;
            }

            $locked->update([
                'status' => 'cancelled',
                'cancelled_at' => now(),
                'cancellation_reason' => self::PAYMENT_NOT_COMPLETED,
                'cancellation_code' => self::PAYMENT_NOT_COMPLETED_CODE,
            ]);

            BookingStatusLog::create([
                'booking_id' => $locked->id,
                'status' => 'cancelled',
                'changed_by' => null,
                'note' => 'Payment not completed in time',
            ]);

            return $locked;
        });

        if (! $cancelled) {
            return false;
        }

        Log::info('Unpaid GCash/Maya errand cancelled', ['booking_id' => $cancelled->id]);
        event(new BookingCancelled($cancelled, self::paymentNotCompletedNotice($cancelled)));

        return true;
    }

    /** The customer's push for an errand cancelled because its payment never arrived. */
    public static function paymentNotCompletedNotice(Booking $booking): string
    {
        return CancellationNotice::forCustomer($booking, CancellationNotice::PAYMENT_NOT_COMPLETED);
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

        // A runner who already paid for the customer's items is owed that
        // money, and nothing in a cancellation pays it back (the customer's
        // fare is refunded in full). Same alert as adminReturnToMatching, so
        // it reaches finance instead of being lost. Raised before the refund:
        // a refund that throws is finished later by the reaper, which knows
        // nothing about item money.
        $itemCost = round((float) $booking->actual_item_cost, 2);
        if ($booking->runner_id && $itemCost > 0) {
            $runnerName = User::withTrashed()->whereKey($booking->runner_id)->value('full_name') ?: 'The runner';
            AdminAlert::raise(
                'runner_owed_items',
                'warning',
                'Runner owed for items',
                "{$runnerName} paid ".self::peso($itemCost).' for the items on errand '
                    .($booking->booking_number ?? $booking->id).' before staff cancelled it, and is owed it. '
                    .'Settle it with them.',
                $booking->id,
            );
        }

        $this->refundUnfulfilled($booking->id, 'Admin cancelled the booking');

        // Notify + broadcast the cancellation, after the refund so the push can
        // say where the money went. BookingCancelled's listener tells the
        // customer (with the staff reason, which their errand screen already
        // shows) and the runner; its broadcast drops both apps out of the
        // active trip live.
        event(new BookingCancelled($booking, CancellationNotice::forCustomer(
            $booking,
            CancellationNotice::BY_STAFF,
            staffReason: $reason,
        )));
    }

    /**
     * Staff re-run matching for a STUCK errand (no runner assigned yet). Only
     * valid while the booking is `no_runner` or still `pending` — a booking
     * already matched/accepted/in-progress must never be pulled back to pending
     * here (that would strand the assigned runner mid-errand; staff use
     * adminReturnToMatching for that).
     *
     * Refused, like the customer's own "try again", when the money was already
     * returned or never arrived (the errand would run for free) or when a
     * scheduled errand's matching window has not opened yet (a runner would be
     * sent hours early).
     * Starts a new round of matching (freshRound): a full search window from
     * now and fresh offers, runners who missed an earlier one included. An
     * optional wider radius helps when the default search found nobody nearby.
     *
     * @throws BookingStateException with a staff-readable reason.
     */
    public function adminRematch(string $bookingId, ?float $radiusKm = null): void
    {
        $booking = DB::transaction(function () use ($bookingId, $radiusKm) {
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
                'unpaid' => throw new BookingStateException(
                    'This errand hasn’t been paid for yet. Matching starts on its own once the customer’s '
                    .'GCash/Maya payment is confirmed.'
                ),
                'scheduled' => throw new BookingStateException(
                    'This errand is scheduled for '.self::businessTime($locked->scheduled_at)
                    .'. Matching starts on its own at '.self::businessTime(self::matchingOpensAt($locked)).'.'
                ),
                default => null,
            };

            // Back to pending so MatchRunnerJob — which no-ops on any other
            // status — picks it up again.
            $locked->update(['status' => 'pending', ...self::freshRound($locked)]);

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

            return $locked;
        });

        self::armAutoCancel($booking);
        MatchRunnerJob::dispatch($bookingId, $radiusKm);
    }

    /**
     * Staff take an accepted-but-unfinished errand off its runner (they went
     * dark, their vehicle broke down, the customer asked) and offer it to
     * someone else. The removed runner is told and never offered it again in
     * this round, and the customer is told a new runner is on the way. A new
     * round of matching (freshRound) starts right away — or at the window
     * opening for a scheduled errand that is not due yet.
     *
     * The first runner's progress is wiped so the next runner starts clean:
     * pickup time and photos, the receipt and item cost, the shopping-list
     * ticks and the extra stops they visited. When they had already paid for a
     * "Buy for me" errand's items, staff get an alert: that runner is owed the
     * money (the customer repays the NEW runner at the door).
     *
     * Refused when the money for it was already returned or never arrived, so
     * a rescue can never set up an errand that runs for free.
     *
     * @throws BookingStateException with a staff-readable reason.
     */
    public function adminReturnToMatching(string $bookingId, string $reason): void
    {
        [$booking, $runnerId, $oldStatus, $itemCost] = DB::transaction(function () use ($bookingId, $reason) {
            $locked = Booking::whereKey($bookingId)->lockForUpdate()->firstOrFail();

            if ($locked->runner_id === null || ! in_array($locked->status, BookingStatus::IN_PROGRESS, true)) {
                throw new BookingStateException(
                    'Only an errand a runner has accepted and not finished can be returned to matching.'
                );
            }

            if (self::moneyReturned($locked) || self::unpaidOnline($locked)) {
                throw new BookingStateException(
                    'This errand’s payment was refunded or never collected, so it can’t be offered to another '
                    .'runner. Cancel it instead.'
                );
            }

            $runnerId = (string) $locked->runner_id;
            $oldStatus = $locked->status;
            $itemCost = round((float) $locked->actual_item_cost, 2);
            $receipt = $locked->receipt_photo_url;

            $locked->update([
                'status' => 'pending',
                'runner_id' => null,
                'matched_at' => null,
                'accepted_at' => null,
                ...self::freshRound($locked, [$runnerId]),
                ...self::clearedRunnerWork($locked),
            ]);

            BookingStop::where('booking_id', $locked->id)
                ->whereNotNull('completed_at')
                ->update(['completed_at' => null]);

            BookingStatusLog::create([
                'booking_id' => $locked->id,
                'status' => 'pending',
                // A system change (see adminRematch); the admin is in the audit log.
                'changed_by' => null,
                'note' => "Staff returned the errand to matching: {$reason}"
                    .($itemCost > 0
                        ? '. The first runner had paid '.self::peso($itemCost).' for the items'
                            .($receipt ? " (receipt: {$receipt})" : '')
                        : ''),
            ]);

            return [$locked, $runnerId, $oldStatus, $itemCost];
        });

        // Stop tagging the removed runner's GPS pings to this errand.
        Cache::forget("runner_active_booking_id:{$runnerId}");

        // Live update for both apps (`pending` has no push template, so this is
        // broadcast-only — the two pushes below carry the explanation).
        event(new BookingStatusChanged($booking, $oldStatus, 'pending'));

        $number = $booking->booking_number ?? $booking->id;

        if ($itemCost > 0) {
            $runnerName = User::withTrashed()->whereKey($runnerId)->value('full_name') ?: 'The first runner';
            AdminAlert::raise(
                'runner_owed_items',
                'warning',
                'Runner owed for items',
                "{$runnerName} paid ".self::peso($itemCost)." for the items on errand {$number} before it was "
                    .'returned to matching, and is owed it. Settle it with them — the customer will repay the new runner.',
                $booking->id,
            );
        }

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

        self::armAutoCancel($booking);

        $opensAt = self::matchingOpensAt($booking);
        $match = MatchRunnerJob::dispatch($booking->id, null, $runnerId);
        if ($opensAt->isFuture()) {
            $match->delay($opensAt);
        }
    }

    /**
     * The progress a removed runner leaves on an errand, reset for the next
     * one: pickup time and photos, receipt and item cost, and the shopping-list
     * ticks (the items themselves stay).
     *
     * @return array<string, mixed>
     */
    private static function clearedRunnerWork(Booking $booking): array
    {
        $cleared = [
            'picked_up_at' => null,
            'pickup_photo_url' => null,
            'delivery_photo_url' => null,
            'receipt_photo_url' => null,
            'actual_item_cost' => null,
        ];

        if (is_array($booking->shopping_items) && $booking->shopping_items !== []) {
            $cleared['shopping_items'] = array_map(
                fn ($item) => is_array($item) ? [...$item, 'checked' => false, 'checked_at' => null] : $item,
                $booking->shopping_items,
            );
        }

        return $cleared;
    }

    /**
     * Staff mark an accepted-but-unfinished errand completed (the runner did the
     * work but can't finish it in the app). Settles EXACTLY like the runner's
     * own completion — the same booking lock, the same once-only checks, and the
     * same settlement code (BookingSettlementService::settleCompletion): the
     * runner is paid (see completionPayoutNotice), the payment is recorded, and
     * both sides get the usual "Errand completed" notice.
     *
     * Refused when the errand's money was refunded or never collected: it
     * would settle as a completed errand that paid nobody.
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

            if (self::moneyReturned($locked)) {
                throw new BookingStateException(
                    'This errand’s payment was refunded or never collected, so completing it would leave the '
                    .'runner unpaid. Cancel it instead (and pay the runner by hand if they did the work).'
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
        // notices, live status for both apps.
        event(new BookingStatusChanged($booking, $oldStatus, 'completed'));
    }

    /**
     * What completing this errand does for its runner, for staff before they
     * mark it completed — the same branches settleCompletion takes.
     */
    public static function completionPayoutNotice(Booking $booking): string
    {
        if (self::moneyReturned($booking)) {
            return 'Its payment was refunded or never collected, so it can’t be marked completed — cancel it instead.';
        }

        if ($booking->payment_status === 'paid') {
            return 'The runner is paid '.self::peso((float) $booking->runner_payout).' into their ErrandGuy wallet.';
        }

        if ($booking->payment_method === 'cash') {
            $fee = round((float) $booking->total_amount - (float) $booking->runner_payout, 2);

            return 'The runner keeps the '.self::peso((float) $booking->total_amount).' cash they collect from the customer, '
                .'and ErrandGuy’s '.self::peso($fee).' fee is taken from their wallet.';
        }

        return 'Nothing was collected for it yet, so the runner is not paid.';
    }

    /**
     * What a staff cancel does with the money, for the confirm dialog: the
     * customer's refund, that the runner is not paid, and any item money the
     * runner fronted (adminCancel raises an alert for it).
     */
    public static function cancelNotice(Booking $booking): string
    {
        $parts = [];

        $parts[] = $booking->payment_status === 'paid'
            ? 'The customer gets the full '.self::peso((float) $booking->total_amount).' back in their ErrandGuy wallet, with no cancellation fee.'
            : 'Nothing was paid online, so there is nothing to refund.';

        if ($booking->runner_id && in_array($booking->status, BookingStatus::IN_PROGRESS, true)) {
            $runner = $booking->runner?->full_name ?? 'The runner';
            $parts[] = "{$runner} is not paid for this errand.";

            $itemCost = (float) $booking->actual_item_cost;
            if ($itemCost > 0) {
                $parts[] = "{$runner} already paid ".self::peso($itemCost).' for the customer’s items and is owed it — an alert is raised so it gets settled.';
            }

            if (in_array($booking->status, ['arrived_at_dropoff', 'delivered'], true)) {
                $parts[] = 'The runner has already reached the drop-off: if the errand was done, ask finance to use “Mark completed” instead so the runner is paid.';
            }
        }

        return implode(' ', $parts);
    }

    /** "₱1,250.00", for staff-facing messages. */
    private static function peso(float $amount): string
    {
        return '₱'.number_format($amount, 2);
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

            // Only refund an errand that has actually ended unfulfilled. Every
            // caller commits 'cancelled' / 'no_runner' first and refunds in a
            // separate transaction, so anything else here means the errand
            // moved on in between: a runner completed it (refunding delivered
            // work is money out with nothing to reclaim it), or a retry put it
            // back to 'pending' and it is being worked (the refund would land
            // on a live errand and its runner would then be paid nothing).
            if (! in_array($locked->status, ['cancelled', 'no_runner'], true)) {
                Log::warning('refundUnfulfilled called on a booking that is not cancelled — refusing', [
                    'booking_id' => $locked->id,
                    'status' => $locked->status,
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
