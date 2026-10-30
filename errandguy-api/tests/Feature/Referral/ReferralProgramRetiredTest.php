<?php

namespace Tests\Feature\Referral;

use App\Events\BookingStatusChanged;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * The referral program is retired for launch. Its endpoints answer the app
 * build already on phones with a clear 422, its tables and columns are gone,
 * and nothing credits the bonus bucket any more — but bonus credit a customer
 * already has stays spendable, drawn down before their real balance, until it
 * is used up.
 */
class ReferralProgramRetiredTest extends TestCase
{
    use RefreshDatabase;

    private const MIGRATION = 'migrations/2026_10_31_000003_retire_referral_program.php';

    private function assertReferralSchemaIsGone(): void
    {
        $this->assertFalse(Schema::hasTable('referrals'));
        $this->assertFalse(Schema::hasColumn('users', 'referral_code'));
        $this->assertFalse(Schema::hasColumn('users', 'referred_by'));
        // Money history stays.
        $this->assertTrue(Schema::hasColumn('users', 'bonus_balance'));
        $this->assertTrue(Schema::hasColumn('wallet_transactions', 'bonus_portion'));
    }

    public function test_the_referral_tables_and_columns_are_gone_but_bonus_balance_stays(): void
    {
        $this->assertReferralSchemaIsGone();
    }

    public function test_the_migration_reruns_safely_and_rolls_back_to_the_old_structure(): void
    {
        \Illuminate\Support\Facades\DB::table('system_config')->insert([
            ['key' => 'referral_reward_amount', 'value' => '50', 'description' => 'x'],
            ['key' => 'referral_max_rewards_per_referrer', 'value' => '50', 'description' => 'x'],
        ]);

        $migration = require database_path(self::MIGRATION);

        $migration->down();

        $this->assertTrue(Schema::hasTable('referrals'));
        $this->assertTrue(Schema::hasColumn('users', 'referral_code'));
        $this->assertTrue(Schema::hasColumn('users', 'referred_by'));

        $migration->up();
        $this->assertReferralSchemaIsGone();
        $this->assertFalse(\Illuminate\Support\Facades\DB::table('system_config')
            ->whereIn('key', ['referral_reward_amount', 'referral_max_rewards_per_referrer'])->exists());

        // Running it again over an already-clean schema is a no-op, not an error.
        $migration->up();
        $this->assertReferralSchemaIsGone();
    }

    public function test_the_referral_endpoints_answer_the_shipped_app_with_a_clear_422(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->actingAs($customer)->getJson('/api/v1/user/referral')
            ->assertStatus(422)
            ->assertJsonPath('code', 'FEATURE_RETIRED')
            ->assertJsonPath('message', 'The referral program has ended.');

        $this->actingAs($customer)->postJson('/api/v1/user/referral/apply', ['code' => 'ABCD2345'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'The referral program has ended.');
    }

    public function test_registering_no_longer_mints_a_referral_code(): void
    {
        $this->postJson('/api/v1/auth/register', [
            'full_name' => 'Juan Dela Cruz', 'phone' => '+639171234567', 'email' => 'juan@example.com',
            'password' => 'Password1!', 'role' => 'customer',
        ])
            ->assertCreated()
            ->assertJsonMissingPath('user.referral_code');
    }

    public function test_completing_a_first_errand_credits_no_bonus(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'x', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
        $booking = Booking::create([
            'booking_number' => 'EG-20261031-REF001', 'customer_id' => $customer->id, 'errand_type_id' => $type->id,
            'status' => 'completed', 'payment_method' => 'gcash', 'payment_status' => 'paid',
            'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0,
            'total_amount' => 115, 'runner_payout' => 100, 'is_transportation' => false,
        ]);

        event(new BookingStatusChanged($booking, 'in_transit', 'completed'));

        $this->assertFalse(WalletTransaction::where('type', 'bonus')->exists());
        $this->assertEquals(0.0, (float) $customer->fresh()->bonus_balance);
    }

    public function test_existing_bonus_credit_is_still_spent_first_and_never_withdrawn(): void
    {
        $customer = User::factory()->create(['wallet_balance' => 100, 'bonus_balance' => 40]);
        $wallet = app(WalletService::class);

        // Spent before the real balance...
        $tx = $wallet->deduct($customer->id, 50, (string) \Illuminate\Support\Str::uuid(), 'Errand');
        $this->assertEquals(40.0, (float) $tx->bonus_portion);
        $this->assertEquals(90.0, (float) $customer->fresh()->wallet_balance);
        $this->assertEquals(0.0, (float) $customer->fresh()->bonus_balance);

        // ...and never part of what can be withdrawn.
        $bonusOnly = User::factory()->create(['wallet_balance' => 0, 'bonus_balance' => 200]);
        $this->expectException(\App\Exceptions\WithdrawalException::class);
        $wallet->createPendingPayout($bonusOnly->id, 50, null, null, 0.0, 'Withdrawal request');
    }

    public function test_the_admin_referrals_page_is_gone(): void
    {
        $this->actingAs(AdminUser::create([
            'email' => 'super@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Super Admin', 'role' => AdminUser::ROLE_SUPER_ADMIN, 'is_active' => true,
        ]), 'admin');

        $this->get('/admin/referrals')->assertNotFound();
    }
}
