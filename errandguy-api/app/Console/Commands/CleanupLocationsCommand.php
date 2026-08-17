<?php

namespace App\Console\Commands;

use App\Models\Message;
use App\Services\LocationService;
use Illuminate\Console\Command;

class CleanupLocationsCommand extends Command
{
    protected $signature = 'errandguy:cleanup-locations';

    protected $description = 'Delete old runner location records (>24h) and old messages (>30 days after booking completed)';

    public function handle(LocationService $locations): int
    {
        // Delete runner locations older than 24 hours. Delegates to the service
        // so there is ONE (batched, indexed) prune implementation — the command
        // previously duplicated this as a single unindexed mass DELETE. (PERF-BE-4)
        $locationCount = $locations->cleanupOldLocations();
        $this->info("Deleted {$locationCount} old runner location records.");

        // Delete messages 30 days after their booking completed, in bounded
        // batches. The previous single DELETE with a correlated whereHas subquery
        // could lock a large slice of the messages table in one statement on a
        // big backlog; select ids first, then delete by primary key (also keeps
        // it cross-engine — no DELETE ... LIMIT, which SQLite rejects).
        $cutoff = now()->subDays(30);
        $messageCount = 0;
        do {
            $ids = Message::whereHas('booking', function ($query) use ($cutoff) {
                $query->where('status', 'completed')
                      ->where('completed_at', '<', $cutoff);
            })->limit(1000)->pluck('id');

            if ($ids->isNotEmpty()) {
                $messageCount += Message::whereKey($ids)->delete();
            }
        } while ($ids->count() === 1000);
        $this->info("Deleted {$messageCount} old message records.");

        return self::SUCCESS;
    }
}
