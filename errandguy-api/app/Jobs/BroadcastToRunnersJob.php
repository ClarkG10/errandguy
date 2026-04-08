<?php

namespace App\Jobs;

use App\Services\MatchingService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class BroadcastToRunnersJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public string $bookingId,
    ) {}

    public function handle(MatchingService $matchingService): void
    {
        $runners = $matchingService->broadcastToRunners($this->bookingId);

        Log::info("Broadcast booking {$this->bookingId} to {$runners->count()} runners");

        // TODO: Send push notifications to each eligible runner via FCM
    }
}
