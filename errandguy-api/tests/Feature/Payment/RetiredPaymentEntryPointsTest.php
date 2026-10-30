<?php

namespace Tests\Feature\Payment;

use App\Models\AdminUser;
use App\Models\ErrandType;
use App\Models\PaymentMethod;
use App\Models\SystemConfig;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Launch payment methods are cash, GCash, Maya and the wallet. Saved cards,
 * linked (one-tap) accounts, GrabPay and wallet top-ups are retired: their
 * endpoints answer the app build already on phones with a clear 422 — never a
 * 404 or a 500 — and an existing linked account is never charged again.
 */
class RetiredPaymentEntryPointsTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
    }

    private function linkedAccount(): PaymentMethod
    {
        return PaymentMethod::create([
            'user_id' => $this->customer->id, 'type' => 'grabpay', 'status' => 'active', 'label' => 'GrabPay',
            'gateway_ref' => 'pm-linked-1', 'is_default' => true,
        ]);
    }

    public function test_the_saved_methods_list_is_empty_even_with_an_old_linked_account(): void
    {
        $this->linkedAccount();

        $this->actingAs($this->customer)->getJson('/api/v1/payments/methods')
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data', []);
    }

    public function test_saving_a_card_is_refused_clearly(): void
    {
        $this->actingAs($this->customer)->postJson('/api/v1/payments/methods', [
            'type' => 'card', 'gateway_token' => 'tok_123',
        ])
            ->assertStatus(422)
            ->assertJsonPath('code', 'FEATURE_RETIRED')
            ->assertJsonPath('message', 'Card payments are no longer available — please pay with GCash, Maya or cash.');

        $this->assertSame(0, PaymentMethod::count());
    }

    public function test_linking_an_account_is_refused_clearly_and_calls_no_gateway(): void
    {
        Http::fake();

        $this->actingAs($this->customer)->postJson('/api/v1/payments/methods/link', ['channel' => 'gcash'])
            ->assertStatus(422)
            ->assertJsonPath('code', 'FEATURE_RETIRED')
            ->assertJsonPath('message', 'Linking a GCash, Maya or GrabPay account is no longer available — you’ll pay with GCash or Maya at checkout each time.');

        Http::assertNothingSent();
    }

    public function test_managing_an_old_linked_account_is_refused_clearly(): void
    {
        $linked = $this->linkedAccount();
        $message = 'Saved payment accounts are no longer available — please pay with GCash, Maya or cash.';

        $this->actingAs($this->customer)->deleteJson("/api/v1/payments/methods/{$linked->id}")
            ->assertStatus(422)->assertJsonPath('message', $message);
        $this->actingAs($this->customer)->putJson("/api/v1/payments/methods/{$linked->id}/default")
            ->assertStatus(422)->assertJsonPath('message', $message);
    }

    public function test_an_old_linked_account_is_never_charged(): void
    {
        // A GCash booking from a customer whose old default was a linked
        // account is a one-time charge — the stored token is never used.
        Bus::fake();
        $this->linkedAccount();
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'x', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
        config(['services.xendit.secret_key' => 'test-secret']);
        Http::fake(['api.xendit.co/payment_requests' => Http::response([
            'id' => 'pr-one-time', 'status' => 'REQUIRES_ACTION', 'actions' => [['url' => 'https://gcash.example/a']],
        ])]);

        $this->actingAs($this->customer)->postJson('/api/v1/bookings', [
            'errand_type_id' => $type->id, 'payment_method' => 'gcash',
            'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.9,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.5, 'dropoff_lng' => 121.0,
            'schedule_type' => 'now', 'vehicle_type_rate' => 'motorcycle',
        ])->assertCreated();

        Http::assertSent(fn ($r) => $r['payment_method']['reusability'] === 'ONE_TIME_USE'
            && ! isset($r['payment_method_id']));
    }

    public function test_the_admin_linked_methods_page_is_gone_and_the_catalog_page_shows_four(): void
    {
        $this->actingAs(AdminUser::create([
            'email' => 'super@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Super Admin', 'role' => AdminUser::ROLE_SUPER_ADMIN, 'is_active' => true,
        ]), 'admin');

        $this->get('/admin/payment-methods')->assertNotFound();
        $this->get('/admin/platform-payment-methods')
            ->assertOk()
            ->assertSee('GCash')
            ->assertSee('Cash on Delivery')
            ->assertDontSee('Credit / Debit Card');
    }

    public function test_the_migration_drops_card_from_the_stored_setting_and_rolls_back(): void
    {
        SystemConfig::setValue('enabled_payment_methods', 'wallet,gcash,card,cash');
        $migration = require database_path('migrations/2026_10_31_000004_launch_payment_methods_and_payout_details.php');

        $migration->up();
        $this->assertSame('wallet,gcash,cash', DB::table('system_config')->where('key', 'enabled_payment_methods')->value('value'));
        $migration->up(); // a re-run is a no-op

        $migration->down();
        $this->assertSame('wallet,gcash,cash,card', DB::table('system_config')->where('key', 'enabled_payment_methods')->value('value'));
        $this->assertFalse(\Illuminate\Support\Facades\Schema::hasColumn('wallet_transactions', 'payout_destination'));

        $migration->up();
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasColumn('wallet_transactions', 'payout_destination'));
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasColumn('wallet_transactions', 'booking_id'));
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasColumn('runner_profiles', 'payout_channel'));
    }
}
