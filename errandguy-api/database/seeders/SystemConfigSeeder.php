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
                'key' => 'max_negotiate_timeout_minutes',
                'value' => '30',
                'description' => 'Maximum time in minutes for negotiate pricing to expire',
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
                'key' => 'route_deviation_threshold_meters',
                'value' => '500',
                'description' => 'Meters of deviation before route deviation alert',
            ],
            [
                'key' => 'ride_duration_alert_multiplier',
                'value' => '2.0',
                'description' => 'Multiplier of estimated duration before ride duration alert',
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
                'key' => 'enabled_payment_methods',
                'value' => 'wallet,gcash,maya,card,cash',
                'description' => 'CSV of payment methods offered to customers (managed via admin). Valid: wallet,gcash,maya,card,cash',
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
