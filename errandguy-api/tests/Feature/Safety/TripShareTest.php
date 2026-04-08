<?php

namespace Tests\Feature\Safety;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TripShareTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        $this->booking = Booking::create([
            'booking_number' => 'EG-20260331-TRIP',
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $errandType->id, 'status' => 'in_transit',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);
    }

    public function test_customer_can_share_trip(): void
    {
        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/share-trip");

        $response->assertOk()
            ->assertJsonStructure(['data' => ['link', 'token']]);

        $this->booking->refresh();
        $this->assertTrue($this->booking->trip_share_active);
        $this->assertNotNull($this->booking->trip_share_token);
    }

    public function test_customer_can_revoke_trip_share(): void
    {
        $this->booking->update([
            'trip_share_token' => 'test-token-1234',
            'trip_share_active' => true,
        ]);

        $response = $this->actingAs($this->customer)
            ->deleteJson("/api/v1/bookings/{$this->booking->id}/share-trip");

        $response->assertOk();

        $this->booking->refresh();
        $this->assertFalse($this->booking->trip_share_active);
        $this->assertNull($this->booking->trip_share_token);
    }

    public function test_public_trip_link_returns_booking_data(): void
    {
        $token = 'public-trip-token-test';
        $this->booking->update([
            'trip_share_token' => $token,
            'trip_share_active' => true,
        ]);

        RunnerProfile::create([
            'user_id' => $this->runner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'vehicle_type' => 'motorcycle',
            'vehicle_plate' => 'ABC-1234',
        ]);

        $response = $this->getJson("/api/v1/trip/{$token}");

        $response->assertOk()
            ->assertJsonStructure([
                'data' => ['booking_id', 'status', 'pickup_address', 'dropoff_address', 'runner'],
            ])
            ->assertJsonPath('data.status', 'in_transit');
    }

    public function test_revoked_trip_link_returns_404(): void
    {
        $this->booking->update([
            'trip_share_token' => 'revoked-token',
            'trip_share_active' => false,
        ]);

        $response = $this->getJson('/api/v1/trip/revoked-token');
        $response->assertStatus(404);
    }

    public function test_invalid_trip_token_returns_404(): void
    {
        $response = $this->getJson('/api/v1/trip/nonexistent-token-xyz');
        $response->assertStatus(404);
    }

    public function test_non_owner_cannot_share_trip(): void
    {
        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $response = $this->actingAs($other)
            ->postJson("/api/v1/bookings/{$this->booking->id}/share-trip");

        $response->assertStatus(404);
    }

    public function test_cannot_share_completed_booking(): void
    {
        $this->booking->update(['status' => 'completed']);

        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/share-trip");

        $response->assertStatus(404);
    }
}
