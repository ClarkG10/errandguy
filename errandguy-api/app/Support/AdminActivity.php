<?php

namespace App\Support;

use Illuminate\Database\Eloquent\Model;

/**
 * Thin wrapper around spatie/activitylog for recording admin-panel actions in
 * the `admin` log channel, always attributing them to the signed-in admin.
 * Use in Filament actions after a sensitive operation succeeds:
 *
 *   AdminActivity::log('refunded', $payment, ['amount' => $amount, 'reason' => $reason]);
 */
class AdminActivity
{
    public static function log(
        string $event,
        ?Model $subject = null,
        array $properties = [],
        ?string $description = null,
    ): void {
        $logger = activity('admin')
            ->event($event)
            ->withProperties($properties);

        if ($admin = auth('admin')->user()) {
            $logger->causedBy($admin);
        }

        if ($subject) {
            $logger->performedOn($subject);
        }

        $logger->log($description ?? $event);
    }
}
