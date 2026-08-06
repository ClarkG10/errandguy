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

    public function __construct(
        public string $bookingId,
        public ?float $radiusOverrideKm = null,
        public ?string $excludeUserId = null,
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

            DB::transaction(function () use ($runner, &$newStatus, &$matchedBooking, &$reMatchExcluding) {
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

                    // Deliver the offer notification OFF the request thread via a
                    // queued job. This job is dispatchSync'd for immediate
                    // bookings, so calling sendPush() inline here ran the Expo/FCM
                    // push HTTP inside the customer's create request. The in-app
                    // row lands ms later; the 201 (matched/no_runner) is unaffected. (P4)
                    SendPushJob::dispatch(
                        $runner->user_id,
                        'New errand offer',
                        'You were matched to an errand. Open the app to accept it.',
                        ['type' => 'booking_update', 'booking_id' => $matchedBooking->id],
                    );

                    // Live "you've got an offer" popup on the runner's private
                    // channel. Replaces the old `bookings` table UPDATE (filtered
                    // by runner_id) the runner app used to subscribe to. Post-
                    // commit, so the runner's fetch sees the assigned row.
                    IncomingRequest::dispatch($matchedBooking);
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
                self::dispatch($this->bookingId, $this->radiusOverrideKm, $reMatchExcluding);
            }
        } catch (Throwable $e) {
            Log::error("MatchRunnerJob failed for booking {$this->bookingId}: {$e->getMessage()}");
            throw $e; // let queue worker apply backoff/tries
        }
    }
}
