<?php

namespace App\Jobs;

use App\Events\BookingStatusChanged;
use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Services\MatchingService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
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
        $runner = $matchingService->findRunner($this->bookingId, $this->radiusOverrideKm);

        try {
            $newStatus = null; // 'matched' | 'no_runner' | null (race-skipped)
            $matchedBooking = null;

            DB::transaction(function () use ($runner, &$newStatus, &$matchedBooking) {
                // Re-fetch with FOR UPDATE so a concurrent MatchRunnerJob
                // (re-dispatch, retry, or admin reassign) cannot also flip
                // the same row from `pending` to `matched`.
                $booking = Booking::whereKey($this->bookingId)->lockForUpdate()->first();

                if (!$booking || $booking->status !== 'pending') {
                    Log::info("MatchRunnerJob race-skipped: booking {$this->bookingId} no longer pending");
                    return;
                }

                if ($runner) {
                    // Defensive: ensure the chosen runner hasn't been claimed
                    // by another booking in the meantime.
                    $stillFree = ! Booking::where('runner_id', $runner->user_id)
                        ->whereNotIn('status', ['pending', 'completed', 'cancelled', 'no_runner'])
                        ->exists();

                    if (!$stillFree) {
                        Log::info("MatchRunnerJob: chosen runner {$runner->user_id} no longer free for booking {$this->bookingId}");
                        // Leave booking pending — outer retry / scheduler will pick it up again.
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
                event(new BookingStatusChanged($matchedBooking, 'pending', $newStatus));
            }
        } catch (Throwable $e) {
            Log::error("MatchRunnerJob failed for booking {$this->bookingId}: {$e->getMessage()}");
            throw $e; // let queue worker apply backoff/tries
        }
    }
}
