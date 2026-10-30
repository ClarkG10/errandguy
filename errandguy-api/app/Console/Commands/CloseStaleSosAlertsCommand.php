<?php

namespace App\Console\Commands;

use App\Services\SOSService;
use Illuminate\Console\Command;

/**
 * Closes an SOS still open 24 hours after its errand ended (completed,
 * cancelled, or no runner found). Nobody called it off and staff never closed
 * it, so it would otherwise keep the alert queue, the badge and the panel alarm
 * lit forever. Each one closed is logged (warning) and marked
 * "Closed automatically" in the panel, with a note saying why.
 *
 * An alert on an errand still in progress is never touched.
 */
class CloseStaleSosAlertsCommand extends Command
{
    protected $signature = 'errandguy:close-stale-sos';

    protected $description = 'Close SOS alerts still open '.SOSService::STALE_AFTER_ERRAND_HOURS.' hours after their errand ended.';

    public function handle(SOSService $sos): int
    {
        $closed = $sos->closeStale();

        $this->info("Closed {$closed} stale SOS alert(s).");

        return self::SUCCESS;
    }
}
