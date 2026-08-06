<?php

namespace Tests\Feature\Audit;

use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Tests\TestCase;

/**
 * Regression guards for the sweep-3 fixes: forgot-password enumeration,
 * date-filter 500s, and the unbounded-address gap.
 */
class DiscoverySweep3Test extends TestCase
{
    use RefreshDatabase;

    public function test_forgot_password_reveals_an_unregistered_email_by_product_decision(): void
    {
        // PRODUCT DECISION (2026-08), deliberately REVERSING the earlier
        // anti-enumeration posture: the reset endpoint now tells the user when
        // an email isn't registered, so the app can show an honest inline error
        // instead of a neutral "if an account exists…". The tradeoff — this is
        // now an account-existence oracle — was explicitly accepted (see
        // ForgotPasswordRequest); the route stays throttled to blunt bulk
        // probing. If that risk is later judged unacceptable, revert
        // ForgotPasswordRequest to the neutral 200 and restore the no-oracle
        // assertions here.
        User::factory()->create(['email' => 'real@example.com', 'status' => 'active']);

        $known = $this->postJson('/api/v1/auth/forgot-password', ['email' => 'real@example.com']);
        $unknown = $this->postJson('/api/v1/auth/forgot-password', ['email' => 'nobody@example.com']);

        // A known email proceeds; an unknown one is rejected with an honest,
        // registration-revealing 422.
        $known->assertOk();
        $unknown->assertStatus(422);
        $this->assertStringContainsString('registered', (string) $unknown->json('message'));
    }

    public function test_bookings_list_rejects_a_malformed_date_filter_with_422_not_500(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->actingAs($customer)
            ->getJson('/api/v1/bookings?date_from=not-a-date')
            ->assertStatus(422);
    }

    public function test_wallet_transactions_rejects_a_malformed_date_filter_with_422_not_500(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->actingAs($customer)
            ->getJson('/api/v1/wallet/transactions?date_to=garbage')
            ->assertStatus(422);
    }

    public function test_booking_create_rejects_an_absurdly_long_address(): void
    {
        Bus::fake();
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'x',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);

        $this->actingAs($customer)
            ->postJson('/api/v1/bookings', [
                'errand_type_id' => $errandType->id,
                'pickup_address' => str_repeat('A', 5000),
                'pickup_lat' => 14.5995, 'pickup_lng' => 120.9842,
                'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.5547, 'dropoff_lng' => 121.0244,
                'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
                'payment_method' => 'cash',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['pickup_address']);
    }
}
