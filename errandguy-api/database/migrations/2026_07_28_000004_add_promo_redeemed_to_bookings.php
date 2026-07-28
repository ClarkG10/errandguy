<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Payment review P0-7 (consumption-verified promo reversal).
 *
 * `promo_code_id` records that a promo was APPLIED to a booking (for the
 * discount + audit). This new flag records the orthogonal fact of whether that
 * booking actually CONSUMED a global usage slot — i.e. whether redeem()'s
 * conditional increment succeeded (it is skipped when the code hit its limit
 * in the validate→redeem window). A reversal (cancel / fail / expiry) then
 * decrements used_count only for a booking that truly incremented, and the
 * check-and-clear on this flag makes every reversal idempotent — closing the
 * under-count that otherwise let a capped promo be redeemed past its limit.
 *
 * Additive, defaults false, so existing rows and behaviour are untouched.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('bookings') && ! Schema::hasColumn('bookings', 'promo_redeemed')) {
            Schema::table('bookings', function (Blueprint $table) {
                $table->boolean('promo_redeemed')->default(false)->after('promo_code_id');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('bookings') && Schema::hasColumn('bookings', 'promo_redeemed')) {
            Schema::table('bookings', function (Blueprint $table) {
                $table->dropColumn('promo_redeemed');
            });
        }
    }
};
