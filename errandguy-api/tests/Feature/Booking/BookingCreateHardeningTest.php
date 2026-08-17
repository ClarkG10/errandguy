<?php

namespace Tests\Feature\Booking;

use App\Jobs\AutoCancelBookingJob;
use App\Jobs\SendPushJob;
use App\Models\ErrandType;
use App\Models\IdempotencyKey;
use App\Models\PaymentMethod;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * Booking-create robustness fixes from the final code sweep:
 *  - idempotency middleware reclaims an EXPIRED in-flight claim (crash recovery),
 *  - a cash/wallet booking with a linked method id is NOT charged online,
 *  - the create response reflects the real post-sync-match status,
 *  - CORS exposes the custom API headers.
 */
class BookingCreateHardeningTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $type;
    private array $validData;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'surcharge' => 0, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);
        $this->validData = [
            'errand_type_id' => $this->type->id,
            'pickup_address' => '123 Main', 'pickup_lat' => 14.5995, 'pickup_lng' => 120.9842,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.5547, 'dropoff_lng' => 121.0244,
            'description' => 'pkg', 'schedule_type' => 'now', 'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle', 'payment_method' => 'cash',
        ];
    }

    public function test_expired_in_flight_idempotency_claim_is_reclaimed_not_409(): void
    {
        Bus::fake();
        IdempotencyKey::create([
            'user_id' => $this->customer->id, 'idem_key' => 'dead-key',
            'method' => 'POST', 'path' => 'api/v1/bookings',
            'status' => 'in_progress', 'request_hash' => 'x', 'expires_at' => now()->subMinute(),
        ]);

        $this->actingAs($this->customer)
            ->withHeader('Idempotency-Key', 'dead-key')
            ->postJson('/api/v1/bookings', $this->validData)
            ->assertStatus(201);
    }

    public function test_live_in_flight_idempotency_claim_still_returns_409(): void
    {
        IdempotencyKey::create([
            'user_id' => $this->customer->id, 'idem_key' => 'live-key',
            'method' => 'POST', 'path' => 'api/v1/bookings',
            'status' => 'in_progress', 'request_hash' => 'x', 'expires_at' => now()->addMinute(),
        ]);

        $this->actingAs($this->customer)
            ->withHeader('Idempotency-Key', 'live-key')
            ->postJson('/api/v1/bookings', $this->validData)
            ->assertStatus(409);
    }

    public function test_cash_booking_with_a_saved_method_id_is_not_charged_online(): void
    {
        Bus::fake();
        $method = PaymentMethod::create([
            'user_id' => $this->customer->id, 'type' => 'card', 'status' => 'active',
            'label' => 'Visa •• 42', 'gateway_ref' => 'pm_test_123',
        ]);

        $response = $this->actingAs($this->customer)->postJson('/api/v1/bookings', [
            ...$this->validData, // payment_method: cash
            'payment_method_id' => $method->id,
        ]);

        $response->assertStatus(201)->assertJsonPath('checkout_url', null);
        $this->assertDatabaseHas('bookings', [
            'id' => $response->json('data.id'),
            'payment_method' => 'cash',
            'payment_status' => 'unpaid', // never online-settled
        ]);
    }

    public function test_immediate_booking_response_reflects_the_matched_status(): void
    {
        // Let MatchRunnerJob run for real (it sets status='matched'), but fake the
        // push job + events so the match's notifications don't reach the Firebase
        // SDK (which stalls with no creds in tests). The status update is a plain
        // DB write, unaffected by these fakes.
        // Fake the push job (Firebase stalls with no creds) and the delayed
        // auto-cancel (the test's sync queue would otherwise run it immediately,
        // ignoring its 30-min delay). MatchRunnerJob itself is NOT faked, so the
        // real match runs and sets status='matched'.
        Bus::fake([SendPushJob::class, AutoCancelBookingJob::class]);
        Event::fake();

        // A real online, approved runner near the pickup — the sync match hits them.
        RunnerProfile::create([
            'user_id' => User::factory()->create(['role' => 'runner', 'status' => 'active'])->id,
            'verification_status' => 'approved', 'is_online' => true,
            'current_lat' => 14.6000, 'current_lng' => 120.9850, 'preferred_types' => [],
            'last_location_at' => now(),
        ]);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->validData)
            ->assertStatus(201)
            ->assertJsonPath('data.status', 'matched'); // was stale 'pending' before the refresh fix
    }

    public function test_absurd_estimated_item_value_is_rejected_not_500(): void
    {
        // Above the decimal(10,2) column ceiling would 500 under strict MySQL;
        // the max: rule turns it into a clean 422.
        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->validData, 'estimated_item_value' => 999999999999])
            ->assertStatus(422);
    }

    public function test_cors_allows_and_exposes_the_custom_api_headers(): void
    {
        $this->assertContains('Idempotency-Key', config('cors.allowed_headers'));
        $this->assertContains('If-None-Match', config('cors.allowed_headers'));
        $this->assertContains('ETag', config('cors.exposed_headers'));
        $this->assertContains('X-Request-Id', config('cors.exposed_headers'));
    }
}
