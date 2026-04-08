<?php

namespace App\Jobs;

use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Services\MatchingService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class MatchRunnerJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $backoff = 10;

    public function __construct(
        public string $bookingId,
    ) {}

    public function handle(MatchingService $matchingService): void
    {
        $booking = Booking::find($this->bookingId);

        if (!$booking || $booking->status !== 'pending') {
            Log::info("MatchRunnerJob skipped: booking {$this->bookingId} not pending");
            return;
        }

        $runner = $matchingService->findRunner($this->bookingId);

        if ($runner) {
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
        } else {
            $booking->update(['status' => 'no_runner']);

            BookingStatusLog::create([
                'booking_id' => $booking->id,
                'status' => 'no_runner',
                'changed_by' => null,
                'note' => 'No available runners found',
            ]);

            Log::info("No runners found for booking {$this->bookingId}");
        }
    }
}
