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

        // Delete messages 30 days after booking completed
        $messageCount = Message::whereHas('booking', function ($query) {
            $query->where('status', 'completed')
                  ->where('completed_at', '<', now()->subDays(30));
        })->delete();
        $this->info("Deleted {$messageCount} old message records.");

        return self::SUCCESS;
    }
}
