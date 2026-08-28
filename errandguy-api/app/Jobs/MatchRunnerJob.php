<?php

namespace App\Jobs;

use App\Events\BookingStatusChanged;
use App\Events\IncomingRequest;
use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Services\MatchingService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

class MatchRunnerJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $backoff = 10;

    /**
     * How many sweeps the automatic widening ladder gets in total (including
     * this first one) before the booking is declared unmatchable, and how far
     * apart they sit. Overridable via SystemConfig so operations can tune
     * matching aggressiveness per market without a deploy.
     */
    private const DEFAULT_LADDER_ATTEMPTS = 3;
    private const DEFAULT_LADDER_DELAY_SECONDS = 45;

    /**
     * Radius multipliers per sweep, mirroring the manual "try again" ladder in
     * BookingController::retryMatch so an automatic re-sweep and a customer-
     * initiated one search exactly the same ground.
     */
    private const LADDER_MULTIPLIERS = [1 => 1.0, 2 => 1.75, 3 => 2.5];

    public function __construct(
        public string $bookingId,
        public ?float $radiusOverrideKm = null,
        public ?string $excludeUserId = null,
        /**
         * 1-based position on the widening ladder. Appended last so every
         * existing positional call site keeps its meaning.
         */
        public int $attempt = 1,
    ) {}

    public function handle(MatchingService $matchingService): void
    {
        // Cheap pre-check outside the transaction — avoid acquiring a row
        // lock for bookings that are obviously already done.
        $current = Booking::find($this->bookingId);
        if (!$current || $current->status !== 'pending') {
            Log::info("MatchRunnerJob skipped: booking {$this->bookingId} not pending");
            return;
        }

        // Resolve the runner outside the transaction. Matching is read-only
        // and can be slow (haversine over many runners) — holding the row
        // lock during it would serialize all incoming bookings.
        $runner = $matchingService->findRunner($this->bookingId, $this->radiusOverrideKm, $this->excludeUserId);

        try {
            $newStatus = null; // 'matched' | 'no_runner' | null (race-skipped)
            $matchedBooking = null;
            $reMatchExcluding = null; // set when the chosen runner was taken mid-race
            $retryAtRadius = null;    // set when the widening ladder has another sweep left

            DB::transaction(function () use ($runner, &$newStatus, &$matchedBooking, &$reMatchExcluding, &$retryAtRadius) {
                // Re-fetch with FOR UPDATE so a concurrent MatchRunnerJob
                // (re-dispatch, retry, or admin reassign) cannot also flip
                // the same row from `pending` to `matched`.
                $booking = Booking::whereKey($this->bookingId)->lockForUpdate()->first();

                if (!$booking || $booking->status !== 'pending') {
                    Log::info("MatchRunnerJob race-skipped: booking {$this->bookingId} no longer pending");
                    return;
                }

                if ($runner) {
                    // Serialize competing matches ON THE RUNNER, not just the
                    // booking: two bookings' jobs each lock their own (distinct)
                    // booking row, so without also locking the runner, both could
                    // pass the stillFree check under READ COMMITTED and assign the
                    // same runner. Lock order is Booking→User, matching the
                    // settle-earnings path (no new deadlock cycle).
                    \App\Models\User::whereKey($runner->user_id)->lockForUpdate()->first();

                    // Now re-check (under the runner lock) that the chosen runner
                    // hasn't been claimed by another booking in the meantime.
                    $stillFree = ! Booking::where('runner_id', $runner->user_id)
                        ->whereNotIn('status', ['pending', 'completed', 'cancelled', 'no_runner'])
                        ->exists();

                    if (!$stillFree) {
                        Log::info("MatchRunnerJob: chosen runner {$runner->user_id} no longer free for booking {$this->bookingId}");
                        // Don't strand the booking pending (no sweeper re-matches
                        // 'pending') — re-run matching excluding this runner.
                        $reMatchExcluding = $runner->user_id;
                        return;
                    }

                    $booking->update([
                        'runner_id' => $runner->user_id,
                        'status' => 'matched',
                        'matched_at' => now(),
                    ]);

                    BookingStatusLog::create([
                        'booking_id' => $booking->id,
                        'status' => 'matched',
                        'changed_by' => null,
                        'note' => 'Runner matched: ' . ($runner->user->full_name ?? 'Unknown'),
                    ]);

                    // NOTE: the in-app "New errand offer" notification is
                    // persisted by the post-commit NotificationService::sendPush
                    // below (it does its own Notification::create), so we do NOT
                    // create one here — doing both wrote two identical rows and
                    // the runner saw a duplicate offer. Actively offering the
                    // errand (vs. letting the runner discover it by polling) is
                    // still the point — see the sendPush call after commit.
                    Log::info("Runner {$runner->user_id} matched to booking {$this->bookingId}");
                    $newStatus = 'matched';
                    $matchedBooking = $booking->fresh();
                } else {
                    // Nobody in range RIGHT NOW. That is a snapshot, not a
                    // verdict: runners come online, finish their current job,
                    // or drive into range within a minute or two. Declaring
                    // `no_runner` on the first empty sweep terminated the
                    // booking (and auto-refunded it) seconds after the customer
                    // paid, so they had to notice and rebook by hand — the
                    // manual "try again" the app offers is this same search at
                    // a wider radius, which the customer should not have to ask
                    // for. Leave the row `pending` ("Finding a runner…", the
                    // honest state) and re-sweep on a widening ladder instead.
                    $nextRadius = $this->nextLadderRadius();

                    if ($nextRadius !== null) {
                        Log::info(
                            "No runners found for booking {$this->bookingId} "
                            ."(attempt {$this->attempt}) — re-sweeping at {$nextRadius}km"
                        );
                        // Stay `pending`; $newStatus stays null so the
                        // post-commit block (event + refund + admin alert) is
                        // skipped entirely. The re-dispatch happens after commit.
                        $retryAtRadius = $nextRadius;

                        return;
                    }

                    $booking->update(['status' => 'no_runner']);

                    BookingStatusLog::create([
                        'booking_id' => $booking->id,
                        'status' => 'no_runner',
                        'changed_by' => null,
                        'note' => 'No available runners found',
                    ]);

                    Log::info("No runners found for booking {$this->bookingId}");
                    $newStatus = 'no_runner';
                    $matchedBooking = $booking->fresh();
                }
            });

            // Dispatch the status change event AFTER the transaction commits so
            // listeners (notifications, push, audit) see the persisted row.
            // Without this, downstream side-effects never fire when the system
            // (vs. the runner) flips a booking out of `pending` — that was the
            // root cause of "runner can't receive request" for fixed-mode
            // bookings whose listeners depended on this event.
            if ($newStatus && $matchedBooking) {
                // Bust the runner's active-booking cache so the very next
                // /runner/location push tags the row with this booking_id.
                // Without this the customer's realtime subscription
                // (filter: booking_id=eq.…) silently drops up to ~30s of
                // pings, which is exactly the window during which the
                // runner appears as a static dot to the customer.
                if ($newStatus === 'matched' && $runner) {
                    Cache::forget("runner_active_booking_id:{$runner->user_id}");

                    // Best-effort "you've been matched" notifications to the runner:
                    //  - SendPushJob (ShouldQueue) — the Expo/FCM HTTP happens in a
                    //    worker, off the customer's create request.
                    //  - IncomingRequest (ShouldBroadcast) — the live offer popup on
                    //    the runner's private channel; the Reverb publish also happens
                    //    in a worker, so a Reverb outage never reaches here.
                    // What we guard is the SYNCHRONOUS enqueue: this job is
                    // dispatchSync'd on the create path and the outer catch RE-THROWS,
                    // so a transient broadcast/queue hiccup at enqueue time must not
                    // fail a booking whose payment + match already committed. The
                    // runner still learns of the offer from the persisted row + a REST
                    // fetch. (BookingStatusChanged below is intentionally NOT wrapped —
                    // it drives real listeners incl. the referral reward, which must
                    // not be silently swallowed.)
                    try {
                        SendPushJob::dispatch(
                            $runner->user_id,
                            'New errand offer',
                            'You were matched to an errand. Open the app to accept it.',
                            [
                                'type' => 'booking_update',
                                'booking_id' => $matchedBooking->id,
                                // Additive offer metadata so the runner's offer
                                // modal can open with a TRUTHFUL countdown and a
                                // pickup distance from the push alone — it used
                                // to hardcode a 30s window against the server's
                                // 90s one (offers vanished a minute before the
                                // accept stopped being honoured) and could show
                                // no distance at all before a GPS fix landed.
                                // Same values the REST payload carries, from the
                                // same shared helper / matching computation.
                                'accept_deadline' => \App\Services\BookingService::matchAcceptDeadline(
                                    $matchedBooking->matched_at,
                                ),
                                'distance_to_pickup_km' => $runner->distance_km !== null
                                    ? round((float) $runner->distance_km, 1)
                                    : null,
                            ],
                        );
                        IncomingRequest::dispatch($matchedBooking);
                    } catch (Throwable $e) {
                        Log::warning("Match notification enqueue failed for booking {$matchedBooking->id}: {$e->getMessage()}");
                    }
                }
                event(new BookingStatusChanged($matchedBooking, 'pending', $newStatus));

                // No runner was ever matched → the customer never received the
                // service, so return any money already collected (online/wallet
                // paid up front). Runs AFTER commit in its own locked+idempotent
                // transaction; cash/unpaid bookings collected nothing so this is
                // a no-op for them.
                if ($newStatus === 'no_runner') {
                    app(\App\Services\BookingService::class)
                        ->refundUnfulfilled($this->bookingId, 'No runner available — auto-refund');

                    // Live operator alert — a stuck errand needs a human to
                    // reassign / widen matching. Best-effort.
                    \App\Models\AdminAlert::raise(
                        'no_runner',
                        'warning',
                        'No runner found',
                        'Booking '.($matchedBooking->booking_number ?? $matchedBooking->id).' could not be matched.',
                        $matchedBooking->id,
                    );
                }
            }

            // The chosen runner was claimed by another booking in the race
            // window — requeue matching (excluding them) so the booking isn't
            // left stranded 'pending' (mirrors ExpireStaleMatchesJob). Fires
            // AFTER commit; async so we don't recurse inside this job.
            if ($reMatchExcluding !== null) {
                self::dispatch($this->bookingId, $this->radiusOverrideKm, $reMatchExcluding, $this->attempt);
            }

            // Widening ladder: nobody was in range this sweep, so try again
            // shortly over a bigger area. Dispatched AFTER commit and always
            // asynchronously — the first sweep runs dispatchSync on the booking
            // -create request, and the customer must never wait on a re-sweep.
            // The next run re-checks `status === 'pending'` first, so a runner
            // who accepts in the meantime, an auto-cancel, or a customer
            // cancellation all silently end the ladder.
            if ($retryAtRadius !== null) {
                self::dispatch($this->bookingId, $retryAtRadius, $this->excludeUserId, $this->attempt + 1)
                    ->delay(now()->addSeconds(self::ladderDelaySeconds()));
            }
        } catch (Throwable $e) {
            Log::error("MatchRunnerJob failed for booking {$this->bookingId}: {$e->getMessage()}");
            throw $e; // let queue worker apply backoff/tries
        }
    }

    /**
     * The radius (km) the NEXT sweep should use, or null when the ladder is
     * finished and the booking should be declared `no_runner` now.
     *
     * Two independent stops:
     *  - the configured attempt count is spent, or
     *  - the next sweep would land after the booking's auto-cancel deadline.
     *    Past that point AutoCancelBookingJob (and the cron reaper behind it)
     *    ends the booking anyway, so continuing would only delay the customer's
     *    "no runner found" message and their refund. Better to tell them now.
     */
    private function nextLadderRadius(): ?float
    {
        $maxAttempts = (int) \App\Models\SystemConfig::getValue(
            'matching_retry_attempts',
            (string) self::DEFAULT_LADDER_ATTEMPTS,
        );

        $next = $this->attempt + 1;

        if ($next > $maxAttempts || ! isset(self::LADDER_MULTIPLIERS[$next])) {
            return null;
        }

        $booking = Booking::find($this->bookingId);

        if (! $booking) {
            return null;
        }

        $timeoutMinutes = (int) \App\Models\SystemConfig::getValue('auto_cancel_timeout_minutes', '30');

        // A SCHEDULED booking's clock starts when its window opens, not when it
        // was created: BookingController::store defers matching to
        // scheduled_at - 15min and delays AutoCancelBookingJob to matchAt +
        // timeout, and ReapStrandedBookingsCommand::scheduleAwareWindow anchors
        // the same way. Measuring from created_at would make a booking placed
        // days ahead look long past its deadline on its very first sweep, so
        // the ladder would never run for exactly the bookings whose window is
        // narrowest.
        $anchor = ($booking->schedule_type === 'scheduled' && $booking->scheduled_at)
            ? $booking->scheduled_at
            : $booking->created_at;
        $deadline = $anchor?->copy()->addMinutes($timeoutMinutes);

        if ($deadline && now()->addSeconds(self::ladderDelaySeconds())->greaterThanOrEqualTo($deadline)) {
            return null;
        }

        $baseRadius = (float) \App\Models\SystemConfig::getValue('matching_radius_km', '10');

        return round($baseRadius * self::LADDER_MULTIPLIERS[$next], 2);
    }

    private static function ladderDelaySeconds(): int
    {
        return max(5, (int) \App\Models\SystemConfig::getValue(
            'matching_retry_delay_seconds',
            (string) self::DEFAULT_LADDER_DELAY_SECONDS,
        ));
    }
}
