<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

class BookingLifecycleTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $deliveryType;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $this->deliveryType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Send packages',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'surcharge' => 0.00, 'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        $this->booking = Booking::create([
            'booking_number' => 'EG-20260331-TEST',
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->deliveryType->id,
            'status' => 'pending',
            'pickup_address' => '123 Main St',
            'pickup_lat' => 14.5995, 'pickup_lng' => 120.9842,
            'dropoff_address' => '456 Oak Ave',
            'dropoff_lat' => 14.5547, 'dropoff_lng' => 121.0244,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.5, 'base_fee' => 50.00, 'distance_fee' => 55.00,
            'service_fee' => 15.75, 'surcharge' => 0.00, 'total_amount' => 120.75,
            'runner_payout' => 89.25, 'is_transportation' => false,
        ]);
    }

    // ───── Show Booking ─────

    public function test_customer_can_view_own_booking(): void
    {
        $response = $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$this->booking->id}");

        $response->assertOk()
            ->assertJsonPath('data.id', $this->booking->id)
            ->assertJsonPath('data.booking_number', 'EG-20260331-TEST');
    }

    public function test_other_customer_cannot_view_booking(): void
    {
        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $response = $this->actingAs($other)
            ->getJson("/api/v1/bookings/{$this->booking->id}");

        $response->assertStatus(403);
    }

    // ───── Cancel Booking ─────

    public function test_customer_can_cancel_pending_booking(): void
    {
        Event::fake();

        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/cancel", [
                'reason' => 'Changed my mind',
            ]);

        $response->assertOk()
            ->assertJsonPath('data.status', 'cancelled');

        $this->assertDatabaseHas('bookings', [
            'id' => $this->booking->id,
            'status' => 'cancelled',
            'cancelled_by' => $this->customer->id,
        ]);

        $this->assertDatabaseHas('booking_status_logs', [
            'booking_id' => $this->booking->id,
            'status' => 'cancelled',
        ]);
    }

    public function test_cannot_cancel_completed_booking(): void
    {
        $this->booking->update(['status' => 'completed']);

        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/cancel", [
                'reason' => 'Too late',
            ]);

        $response->assertStatus(403);
    }

    public function test_cancel_requires_reason(): void
    {
        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/cancel", []);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['reason']);
    }

    // ───── Active Booking ─────

    public function test_customer_can_get_active_booking(): void
    {
        $response = $this->actingAs($this->customer)
            ->getJson('/api/v1/bookings/active');

        $response->assertOk()
            ->assertJsonPath('data.id', $this->booking->id);
    }

    public function test_active_returns_null_when_no_active_booking(): void
    {
        $this->booking->update(['status' => 'completed']);

        $response = $this->actingAs($this->customer)
            ->getJson('/api/v1/bookings/active');

        $response->assertOk()
            ->assertJsonPath('data', null);
    }

    // ───── Track Booking ─────

    public function test_customer_can_track_booking(): void
    {
        $response = $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$this->booking->id}/track");

        $response->assertOk()
            ->assertJsonStructure(['data' => ['booking', 'runner_location']]);
    }

    // ───── Estimate ─────

    public function test_customer_can_get_price_estimate(): void
    {
        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings/estimate', [
                'errand_type_id' => $this->deliveryType->id,
                'pickup_lat' => 14.5995,
                'pickup_lng' => 120.9842,
                'dropoff_lat' => 14.5547,
                'dropoff_lng' => 121.0244,
            ]);

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'walk' => ['base_fee', 'distance_km', 'total_amount'],
                    'bicycle' => ['base_fee', 'total_amount'],
                    'motorcycle' => ['base_fee', 'total_amount'],
                    'car' => ['base_fee', 'total_amount'],
                ],
            ]);
    }

    // ───── Rebook ─────

    public function test_customer_can_rebook_completed_booking(): void
    {
        Bus::fake();
        Event::fake();

        $this->booking->update(['status' => 'completed']);

        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/rebook");

        $response->assertStatus(201)
            ->assertJsonPath('data.status', 'pending');

        // New booking created
        $this->assertEquals(2, Booking::count());
        $newBooking = Booking::where('id', '!=', $this->booking->id)->first();
        $this->assertEquals($this->booking->pickup_address, $newBooking->pickup_address);
        $this->assertNotEquals($this->booking->booking_number, $newBooking->booking_number);
    }

    // ───── Booking List ─────

    public function test_customer_can_list_bookings(): void
    {
        $response = $this->actingAs($this->customer)
            ->getJson('/api/v1/bookings');

        $response->assertOk()
            ->assertJsonStructure(['data']);
    }

    public function test_customer_can_filter_bookings_by_status(): void
    {
        Booking::create([
            'booking_number' => 'EG-20260331-TST2',
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->deliveryType->id,
            'status' => 'completed',
            'pickup_address' => '789 Pine St', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '321 Elm St', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 3.0, 'base_fee' => 50.00, 'distance_fee' => 30.00,
            'service_fee' => 12.00, 'surcharge' => 0.00, 'total_amount' => 92.00,
            'runner_payout' => 68.00, 'is_transportation' => false,
        ]);

        $response = $this->actingAs($this->customer)
            ->getJson('/api/v1/bookings?status=completed');

        $response->assertOk();
        $data = $response->json('data');
        foreach ($data as $booking) {
            $this->assertEquals('completed', $booking['status']);
        }
    }
}
