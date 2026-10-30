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
                'key' => 'runner_payout_percent',
                'value' => '85',
                'description' => 'Percentage of booking amount paid to runner',
            ],
            [
                'key' => 'auto_cancel_timeout_minutes',
                'value' => '5',
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
                'key' => 'sos_link_expiry_minutes',
                'value' => '60',
                'description' => 'Minutes before SOS live tracking link expires',
            ],
            [
                'key' => 'location_update_interval_seconds',
                'value' => '5',
                'description' => 'Seconds between runner location updates',
            ],
            [
                'key' => 'max_saved_addresses',
                'value' => '10',
                'description' => 'Maximum number of saved addresses per user',
            ],
            [
                'key' => 'max_trusted_contacts',
                'value' => '5',
                'description' => 'Maximum number of trusted contacts per user',
            ],
            [
                'key' => 'shopping_budget_max',
                'value' => '3000',
                'description' => 'Most a runner can pay for a customer’s “Buy for me” items, in pesos. The customer repays it in cash at the door.',
            ],
            [
                'key' => 'enabled_payment_methods',
                'value' => 'wallet,gcash,maya,cash',
                'description' => 'CSV of payment methods offered to customers (managed via admin). Valid: wallet,gcash,maya,cash',
            ],
        ];

        foreach ($configs as $config) {
            SystemConfig::updateOrCreate(
                ['key' => $config['key']],
                $config
            );
        }
    }
}
