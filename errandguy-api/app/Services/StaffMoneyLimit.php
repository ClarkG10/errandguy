<?php

namespace App\Services;

use App\Models\AdminAlert;
use App\Models\AdminUser;
use App\Models\SystemConfig;
use App\Models\WalletTransaction;
use App\Support\BusinessDay;
use App\Support\SystemSettings;
use Illuminate\Support\Facades\DB;

/**
 * Limits on money staff move by hand — wallet adjustments and "Pay a runner"
 * payouts (WalletService::adjust / ::payout), both stamped with
 * initiated_by_staff_id:
 *
 *   - admin_adjustment_daily_cap: the most one staff member can move in one
 *     Manila day, credits, debits and payouts added together (₱20,000 to
 *     start). Checked inside the money transaction with the staff member's
 *     row locked, so two of their moves at once can't both slip under it.
 *   - admin_adjustment_alert_threshold: any single move this large or larger
 *     (₱5,000 to start) raises a dashboard alert for money staff.
 */
final class StaffMoneyLimit
{
    public const DAILY_CAP_KEY = 'admin_adjustment_daily_cap';

    public const ALERT_THRESHOLD_KEY = 'admin_adjustment_alert_threshold';

    /** Alert types raised here; shown only to money roles (LiveAlertsWidget). */
    public const ALERT_ADJUSTMENT = 'staff_large_adjustment';

    public const ALERT_PAYOUT = 'staff_large_payout';

    public static function dailyCap(): float
    {
        return self::setting(self::DAILY_CAP_KEY);
    }

    public static function alertThreshold(): float
    {
        return self::setting(self::ALERT_THRESHOLD_KEY);
    }

    /** Pesos this staff member has moved by hand since Manila midnight. */
    public static function movedToday(AdminUser $staff): float
    {
        return round((float) WalletTransaction::query()
            ->where('initiated_by_staff_id', $staff->getKey())
            ->where('created_at', '>=', BusinessDay::start())
            ->sum(DB::raw('abs(amount)')), 2);
    }

    public static function remainingToday(AdminUser $staff): float
    {
        return max(0.0, round(self::dailyCap() - self::movedToday($staff), 2));
    }

    /**
     * Lock the staff member's row for the rest of the transaction, so their
     * money moves happen one at a time. Take it before any other read in that
     * transaction: on MySQL the day's total must be read after the lock, or a
     * move committed just before could be missed.
     */
    public static function lockStaff(AdminUser $staff): void
    {
        AdminUser::whereKey($staff->getKey())->lockForUpdate()->first();
    }

    /**
     * Refuse a move that would take this staff member over today's cap. Call
     * inside the transaction that records the move (it takes the lock itself
     * if lockStaff() wasn't called first).
     *
     * @throws \RuntimeException
     */
    public static function assertWithinDailyCap(AdminUser $staff, float $amount): void
    {
        self::lockStaff($staff);

        $cap = self::dailyCap();
        $moved = self::movedToday($staff);

        if (round($moved + abs($amount), 2) > $cap) {
            throw new \RuntimeException(sprintf(
                'This would take you over your daily limit of ₱%s for money moved by hand (₱%s used today, ₱%s left). A super admin can change the limit in System configs.',
                number_format($cap, 2),
                number_format($moved, 2),
                number_format(max(0, $cap - $moved), 2),
            ));
        }
    }

    /** Raise a dashboard alert when a single move reaches the threshold. Call after commit. */
    public static function alertIfLarge(string $type, AdminUser $staff, float $amount, string $title, string $body, ?string $subjectId): void
    {
        if (abs($amount) < self::alertThreshold()) {
            return;
        }

        AdminAlert::raise($type, 'warning', $title, $body.' By '.($staff->full_name ?: $staff->email).' ('.$staff->role.').', $subjectId);
    }

    /** The configured peso amount, or the default when unset or out of range. */
    private static function setting(string $key): float
    {
        $definition = SystemSettings::get($key);
        $raw = trim((string) SystemConfig::getValue($key, $definition['default']));

        return SystemSettings::problem($key, $definition, $raw) === null
            ? (float) $raw
            : (float) $definition['default'];
    }
}
