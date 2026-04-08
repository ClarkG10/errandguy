<?php

namespace App\Console\Commands;

use App\Models\Message;
use App\Models\RunnerLocation;
use Illuminate\Console\Command;

class CleanupLocationsCommand extends Command
{
    protected $signature = 'errandguy:cleanup-locations';

    protected $description = 'Delete old runner location records (>24h) and old messages (>30 days after booking completed)';

    public function handle(): int
    {
        // Delete runner locations older than 24 hours
        $locationCount = RunnerLocation::where('created_at', '<', now()->subHours(24))->delete();
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
