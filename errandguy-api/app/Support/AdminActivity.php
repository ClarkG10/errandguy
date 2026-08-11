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

        // Resolve the acting admin from the Filament session guard OR, in the
        // REST admin API (sanctum) context where the 'admin' guard is empty, the
        // authenticated request user when it is an AdminUser — so API admin
        // actions record their causer, not an anonymous entry.
        $admin = auth('admin')->user();
        if (! $admin instanceof \App\Models\AdminUser) {
            $requestUser = request()->user();
            $admin = $requestUser instanceof \App\Models\AdminUser ? $requestUser : null;
        }
        if ($admin) {
            $logger->causedBy($admin);
        }

        if ($subject) {
            $logger->performedOn($subject);
        }

        $logger->log($description ?? $event);

        // Every mutating admin action funnels through here, so this is the one
        // place to invalidate the cached dashboard stats + nav badges — they
        // recompute (fresh) on the next render instead of waiting out the TTL.
        AdminCache::flush();
    }
}
