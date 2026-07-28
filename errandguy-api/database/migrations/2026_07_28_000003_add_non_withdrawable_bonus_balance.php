<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Payment review P0-6 (CRITICAL): segregate promotional money from cash.
 *
 * Referral/welcome bonuses used to credit the commingled `wallet_balance`,
 * which is withdrawable via payout — so an account could farm alt-referrals
 * and cash the bonuses out as real money. This adds a separate
 * `users.bonus_balance` (spendable on errands, NEVER paid out) and records,
 * per wallet payment, how much of it was funded by that bonus balance
 * (`wallet_transactions.bonus_portion`) so a later refund returns money to
 * the same bucket it came from instead of laundering bonus → withdrawable.
 *
 * Both columns are additive and default 0, so pre-existing rows and the
 * unchanged `wallet_balance` behaviour are untouched.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('users') && ! Schema::hasColumn('users', 'bonus_balance')) {
            Schema::table('users', function (Blueprint $table) {
                // Non-withdrawable promotional balance. Spendable on errands
                // (drawn down before wallet_balance), excluded from payout.
                $table->decimal('bonus_balance', 12, 2)->default(0.00)->after('wallet_balance');
            });
        }

        if (Schema::hasTable('wallet_transactions') && ! Schema::hasColumn('wallet_transactions', 'bonus_portion')) {
            Schema::table('wallet_transactions', function (Blueprint $table) {
                // How much of a 'payment' debit was covered by bonus_balance.
                // Read back on refund to return the non-withdrawable share to
                // bonus_balance rather than to the withdrawable wallet.
                $table->decimal('bonus_portion', 12, 2)->default(0.00)->after('amount');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('users') && Schema::hasColumn('users', 'bonus_balance')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('bonus_balance');
            });
        }

        if (Schema::hasTable('wallet_transactions') && Schema::hasColumn('wallet_transactions', 'bonus_portion')) {
            Schema::table('wallet_transactions', function (Blueprint $table) {
                $table->dropColumn('bonus_portion');
            });
        }
    }
};
