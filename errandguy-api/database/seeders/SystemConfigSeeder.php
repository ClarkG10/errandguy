<?php

namespace Database\Seeders;

use App\Models\SystemConfig;
use Illuminate\Database\Seeder;

class SystemConfigSeeder extends Seeder
{
    public function run(): void
    {
        $configs = [
            [
                'key' => 'platform_fee_percent',
                'value' => '15',
                'description' => 'Platform fee percentage taken from each booking',
            ],
            [
                'key' => 'auto_cancel_timeout_minutes',
                'value' => '30',
                'description' => 'Minutes before unaccepted booking is auto-cancelled',
            ],
            [
                'key' => 'runner_cash_debt_limit',
                'value' => '1000',
                'description' => 'Max unsettled platform commission (PHP) a runner may owe before they stop being offered CASH errands. 0 disables the block.',
            ],
            [
                'key' => 'matched_acceptance_timeout_seconds',
                'value' => '90',
                'description' => 'Seconds a matched runner has to accept before the booking is re-matched to someone else',
            ],
            [
                'key' => 'shopping_budget_max',
                'value' => '3000',
                'description' => 'Most a runner can pay for a customer’s “Buy for me” items, in pesos. The customer repays it in cash at the door.',
            ],
            [
                'key' => 'ops_alert_emails',
                'value' => '',
                'description' => 'Email addresses (separate with commas) that get an email the moment someone presses SOS, and the ops digest. Leave empty to send none.',
            ],
            [
                'key' => 'ops_alert_phone',
                'value' => '',
                'description' => 'Mobile numbers (separate with commas, e.g. 09171234567) that get a text the moment someone presses SOS. Needs the SMS service to be set up. Leave empty to send none.',
            ],
            [
                'key' => 'enabled_payment_methods',
                'value' => 'wallet,gcash,maya,cash',
                'description' => 'CSV of payment methods offered to customers (managed via admin). Valid: wallet,gcash,maya,cash',
            ],
        ];

        // Only settings that are missing. updateOrCreate put every default
        // back, so one `db:seed` against a live database (a developer .env
        // can point at production) would blank the SOS alert recipients and
        // reset the fee and payment switches staff had set.
        foreach ($configs as $config) {
            SystemConfig::firstOrCreate(
                ['key' => $config['key']],
                $config
            );
        }
    }
}
