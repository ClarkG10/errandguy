<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

abstract class BaseJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * Max retry attempts before marking as failed.
     */
    public int $tries = 3;

    /**
     * Max seconds a job can run before being killed.
     */
    public int $timeout = 60;

    /**
     * Exponential backoff intervals (seconds) between retries.
     */
    public function backoff(): array
    {
        return [10, 30, 60];
    }

    /**
     * Handle job failure.
     */
    public function failed(?\Throwable $exception): void
    {
        Log::error(static::class . ' failed: ' . $exception?->getMessage(), [
            'job' => static::class,
            'exception' => $exception,
        ]);
    }
}
