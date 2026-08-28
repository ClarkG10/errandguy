<?php

namespace App\Jobs;

use App\Events\OfferWithdrawn;
use App\Models\Notification;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Takes back the broadcast offer cards for an errand that can no longer be
 * accepted.
 *
 * {@see BroadcastToRunnersJob} fans a persistent `incoming_request` card out to
 * every nearby runner (up to 200). Nothing ever removed them: once one runner
 * won the errand — or it expired, or the customer cancelled — every other
 * runner kept a live-looking offer in their inbox forever, and tapping accept
 * just returned 409 BOOKING_STALE. Runners raced offers that were already gone
 * and cleared the corpses by hand.
 *
 * This deletes those cards in one query and tells each affected runner live, so
 * an open card disappears instead of turning into a wasted tap.
 */
class RetractOfferJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 2;

    public function __construct(
        public string $bookingId,
        /** The winning runner, whose card is left alone (it is their errand now). */
        public ?string $exceptUserId = null,
        public string $reason = 'taken',
    ) {}

    public function handle(): void
    {
        $query = Notification::where('type', 'incoming_request')
            ->where('data->booking_id', $this->bookingId);

        if ($this->exceptUserId !== null) {
            $query->where('user_id', '!=', $this->exceptUserId);
        }

        // Collect the recipients BEFORE deleting — after the delete there is
        // nothing left to tell us whose screens are still showing the offer.
        $userIds = $query->pluck('user_id')->unique();

        if ($userIds->isEmpty()) {
            return;
        }

        // Single bulk delete rather than 200 individual ones.
        $deleted = (clone $query)->delete();

        foreach ($userIds as $userId) {
            try {
                OfferWithdrawn::dispatch((string) $userId, $this->bookingId, $this->reason);
            } catch (Throwable $e) {
                // A Reverb hiccup must not leave the rows half-retracted: the
                // cards are already gone, so the runner's next fetch is correct
                // either way. Live dismissal is the bonus, not the guarantee.
                Log::warning("OfferWithdrawn broadcast failed for {$userId}: {$e->getMessage()}");
            }
        }

        Log::info("RetractOfferJob: withdrew {$deleted} offer card(s) for booking {$this->bookingId} ({$this->reason})");
    }
}
