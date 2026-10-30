<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Launch payment methods: cash, GCash, Maya and the ErrandGuy wallet. Cards,
 * GrabPay, linked e-wallets and wallet top-ups are gone.
 *
 *   1. wallet_transactions.booking_id — the errand a gateway TIP charge is for.
 *      Every started tip charge now gets its own row (a second attempt used to
 *      overwrite the first one's charge reference, so approving the first one
 *      later took the customer's money and credited nobody). Older tip rows
 *      keep the errand in reference_id.
 *   2. wallet_transactions.payout_destination — where a payout is going
 *      (channel, Xendit channel code, account number and name), encrypted.
 *      Recorded on the payout itself so a customer withdrawal, a runner's
 *      request and a payout queued while deleting an account can all be sent
 *      after the account's own details change or are erased.
 *   3. wallet_transactions.payout_sent_at — set the moment a payout is handed
 *      to Xendit, before the answer comes back, so a payout whose response was
 *      lost still reads as "sent" and can't be marked failed by hand.
 *   4. runner_profiles.payout_channel (gcash | maya | bank) and
 *      payout_account_name, so a runner's payout method says which channel it
 *      is instead of being guessed from which number happens to be filled in.
 *   5. The enabled_payment_methods setting loses card (and any other retired
 *      key). The catalog already ignores unknown keys; this keeps the stored
 *      value honest.
 *
 * Every step checks first, so a re-run after a partial failure is a no-op.
 * down() drops the new columns and puts card back in the setting.
 */
return new class extends Migration
{
    private const LAUNCH_METHODS = ['wallet', 'gcash', 'maya', 'cash'];

    public function up(): void
    {
        if (Schema::hasTable('wallet_transactions')) {
            if (! Schema::hasColumn('wallet_transactions', 'booking_id')) {
                Schema::table('wallet_transactions', function (Blueprint $table) {
                    $table->uuid('booking_id')->nullable()->after('reference_id');
                    $table->index(['booking_id', 'type'], 'idx_wallet_tx_booking_type');
                });
            }

            if (! Schema::hasColumn('wallet_transactions', 'payout_destination')) {
                Schema::table('wallet_transactions', function (Blueprint $table) {
                    $table->text('payout_destination')->nullable()->after('checkout_url');
                });
            }

            if (! Schema::hasColumn('wallet_transactions', 'payout_sent_at')) {
                Schema::table('wallet_transactions', function (Blueprint $table) {
                    $table->timestampTz('payout_sent_at')->nullable()->after('processed_at');
                });
            }
        }

        if (Schema::hasTable('runner_profiles')) {
            if (! Schema::hasColumn('runner_profiles', 'payout_channel')) {
                Schema::table('runner_profiles', function (Blueprint $table) {
                    $table->string('payout_channel', 10)->nullable()->after('payout_channel_code');
                });
            }

            if (! Schema::hasColumn('runner_profiles', 'payout_account_name')) {
                Schema::table('runner_profiles', function (Blueprint $table) {
                    $table->string('payout_account_name', 100)->nullable()->after('payout_channel');
                });
            }
        }

        $this->rewriteEnabledMethods(function (array $types): array {
            $kept = array_values(array_intersect($types, self::LAUNCH_METHODS));

            return $kept === [] ? self::LAUNCH_METHODS : $kept;
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('wallet_transactions')) {
            if (Schema::hasColumn('wallet_transactions', 'booking_id')) {
                foreach (Schema::getIndexes('wallet_transactions') as $index) {
                    if (! $index['primary'] && in_array('booking_id', $index['columns'], true)) {
                        Schema::table('wallet_transactions', function (Blueprint $table) use ($index) {
                            $table->dropIndex($index['name']);
                        });
                    }
                }
            }

            $columns = array_values(array_filter(
                ['booking_id', 'payout_destination', 'payout_sent_at'],
                fn (string $column): bool => Schema::hasColumn('wallet_transactions', $column),
            ));
            if ($columns !== []) {
                Schema::table('wallet_transactions', function (Blueprint $table) use ($columns) {
                    $table->dropColumn($columns);
                });
            }
        }

        if (Schema::hasTable('runner_profiles')) {
            $columns = array_values(array_filter(
                ['payout_channel', 'payout_account_name'],
                fn (string $column): bool => Schema::hasColumn('runner_profiles', $column),
            ));
            if ($columns !== []) {
                Schema::table('runner_profiles', function (Blueprint $table) use ($columns) {
                    $table->dropColumn($columns);
                });
            }
        }

        $this->rewriteEnabledMethods(fn (array $types): array => in_array('card', $types, true)
            ? $types
            : [...$types, 'card']);
    }

    /**
     * Rewrite the stored enabled_payment_methods CSV, if there is one, and drop
     * the cached copies so the change is seen straight away.
     *
     * @param  callable(list<string>): list<string>  $rewrite
     */
    private function rewriteEnabledMethods(callable $rewrite): void
    {
        if (! Schema::hasTable('system_config')) {
            return;
        }

        $row = DB::table('system_config')->where('key', 'enabled_payment_methods')->first();
        if (! $row) {
            return;
        }

        $types = array_values(array_filter(array_map('trim', explode(',', (string) $row->value))));
        $value = implode(',', $rewrite($types));

        if ($value !== (string) $row->value) {
            DB::table('system_config')->where('key', 'enabled_payment_methods')->update(['value' => $value]);
        }

        try {
            Cache::forget('system_config:enabled_payment_methods');
            Cache::forget('payments:available_methods');
            Cache::forget('app_config');
        } catch (\Throwable $e) {
            Log::warning('launch_payment_methods: could not drop the payment-method caches', [
                'error' => $e->getMessage(),
            ]);
        }
    }
};
