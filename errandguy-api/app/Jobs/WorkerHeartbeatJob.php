<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Cache;

/**
 * Queue-worker dead-man's switch. The scheduler queues one of these every
 * minute and a running worker stamps the time when it picks it up, so GET
 * /health can tell "the worker is processing jobs" from "jobs are piling up
 * with nobody to run them" — matching, push, auto-cancel and SOS fan-out all
 * ride the queue. A stamp older than 3 minutes means the worker is down or
 * badly backed up.
 */
class WorkerHeartbeatJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public const CACHE_KEY = 'worker:heartbeat';

    public int $tries = 1;

    public function handle(): void
    {
        Cache::put(self::CACHE_KEY, now()->timestamp, 900);
    }
}
