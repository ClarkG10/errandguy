<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\ErrandType;
use App\Models\SystemConfig;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Tests\TestCase;

class CreateBookingTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $deliveryType;
    private ErrandType $transportationType;
    private array $validBookingData;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->customer = User::factory()->create([
            'role' => 'customer',
            'status' => 'active',
        ]);

        $this->deliveryType = ErrandType::create([
            'slug' => 'delivery',
            'name' => 'Delivery',
            'description' => 'Send or receive packages',
            'icon_name' => 'Package',
            'base_fee' => 50.00,
            'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00,
            'per_km_motorcycle' => 10.00,
            'per_km_car' => 18.00,
            'surcharge' => 0.00,
            'min_negotiate_fee' => 30.00,
            'is_active' => true,
            'sort_order' => 1,
        ]);

        $this->transportationType = ErrandType::create([
            'slug' => 'transportation',
            'name' => 'Transportation',
            'description' => 'Get a ride',
            'icon_name' => 'Car',
            'base_fee' => 70.00,
            'per_km_walk' => 0.00,
            'per_km_bicycle' => 0.00,
            'per_km_motorcycle' => 12.00,
            'per_km_car' => 20.00,
            'surcharge' => 0.00,
            'min_negotiate_fee' => 50.00,
            'is_active' => true,
            'sort_order' => 6,
        ]);

        $this->validBookingData = [
            'errand_type_id' => $this->deliveryType->id,
            'pickup_address' => '123 Main St, Manila',
            'pickup_lat' => 14.5995,
            'pickup_lng' => 120.9842,
            'dropoff_address' => '456 Oak Ave, Makati',
            'dropoff_lat' => 14.5547,
            'dropoff_lng' => 121.0244,
            'description' => 'Please pick up a package',
            'schedule_type' => 'now',
            'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle',
            'payment_method' => 'cash',
        ];
    }

    public function test_customer_can_create_fixed_price_booking(): void
    {
        Bus::fake();

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->validBookingData);

        $response->assertStatus(201)
            ->assertJsonStructure([
                'data' => ['id', 'booking_number', 'status', 'pickup_address', 'dropoff_address', 'total_amount'],
                'message',
            ])
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.pickup_address', '123 Main St, Manila');

        $this->assertDatabaseHas('bookings', [
            'customer_id' => $this->customer->id,
            'status' => 'pending',
            'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle',
        ]);

        $booking = Booking::first();
        $this->assertDatabaseHas('booking_status_logs', [
            'booking_id' => $booking->id,
            'status' => 'pending',
            'changed_by' => $this->customer->id,
        ]);
    }

    public function test_booking_number_is_generated(): void
    {
        Bus::fake();

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->validBookingData);

        $response->assertStatus(201);

        $bookingNumber = $response->json('data.booking_number');
        $this->assertStringStartsWith('EG-', $bookingNumber);
        $this->assertMatchesRegularExpression('/^EG-\d{8}-[A-Z0-9]{4}$/', $bookingNumber);
    }

    public function test_pricing_is_calculated_correctly(): void
    {
        Bus::fake();

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->validBookingData);

        $response->assertStatus(201);

        $data = $response->json('data');
        $this->assertGreaterThan(0, (float) $data['base_fee']);
        $this->assertGreaterThanOrEqual(0, (float) $data['distance_fee']);
        $this->assertGreaterThan(0, (float) $data['service_fee']);
        $this->assertGreaterThan(0, (float) $data['total_amount']);
    }

    public function test_transportation_booking_generates_ride_pin(): void
    {
        Bus::fake();

        $data = array_merge($this->validBookingData, [
            'errand_type_id' => $this->transportationType->id,
            'vehicle_type_rate' => 'car',
            'description' => null,
        ]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(201)
            ->assertJsonPath('data.is_transportation', true);

        $booking = Booking::first();
        $this->assertNotNull($booking->ride_pin);
        $this->assertMatchesRegularExpression('/^\d{4}$/', $booking->ride_pin);
        $this->assertTrue($booking->is_transportation);
    }

    public function test_non_transportation_booking_has_no_ride_pin(): void
    {
        Bus::fake();

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->validBookingData);

        $response->assertStatus(201);

        $booking = Booking::first();
        $this->assertNull($booking->ride_pin);
        $this->assertFalse($booking->is_transportation);
    }

    public function test_negotiate_mode_booking(): void
    {
        Bus::fake();

        $data = array_merge($this->validBookingData, [
            'pricing_mode' => 'negotiate',
            'vehicle_type_rate' => null,
            'customer_offer' => 100.00,
        ]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(201)
            ->assertJsonPath('data.pricing_mode', 'negotiate');

        $this->assertDatabaseHas('bookings', [
            'customer_id' => $this->customer->id,
            'pricing_mode' => 'negotiate',
            'customer_offer' => 100.00,
        ]);
    }

    public function test_scheduled_booking_creation(): void
    {
        Bus::fake();

        $scheduledAt = now()->addDay()->setHour(10)->setMinute(0);

        $data = array_merge($this->validBookingData, [
            'schedule_type' => 'scheduled',
            'scheduled_at' => $scheduledAt->toIso8601String(),
        ]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(201)
            ->assertJsonPath('data.schedule_type', 'scheduled');

        $this->assertDatabaseHas('bookings', [
            'customer_id' => $this->customer->id,
            'schedule_type' => 'scheduled',
        ]);
    }

    public function test_match_runner_job_dispatched_for_fixed_pricing(): void
    {
        Bus::fake();

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->validBookingData);

        Bus::assertDispatched(\App\Jobs\MatchRunnerJob::class);
    }

    public function test_broadcast_job_dispatched_for_negotiate_pricing(): void
    {
        Bus::fake();

        $data = array_merge($this->validBookingData, [
            'pricing_mode' => 'negotiate',
            'vehicle_type_rate' => null,
            'customer_offer' => 100.00,
        ]);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        Bus::assertDispatched(\App\Jobs\BroadcastToRunnersJob::class);
    }

    public function test_booking_requires_errand_type(): void
    {
        $data = $this->validBookingData;
        unset($data['errand_type_id']);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['errand_type_id']);
    }

    public function test_booking_requires_pickup_and_dropoff(): void
    {
        $data = $this->validBookingData;
        unset($data['pickup_address'], $data['pickup_lat'], $data['dropoff_address'], $data['dropoff_lat']);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['pickup_address', 'pickup_lat', 'dropoff_address', 'dropoff_lat']);
    }

    public function test_booking_rejects_inactive_errand_type(): void
    {
        $inactiveType = ErrandType::create([
            'slug' => 'inactive-type', 'name' => 'Inactive', 'description' => 'An inactive type',
            'icon_name' => 'X', 'base_fee' => 50.00, 'per_km_walk' => 10.00,
            'per_km_bicycle' => 10.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 10.00,
            'min_negotiate_fee' => 30.00, 'is_active' => false, 'sort_order' => 99,
        ]);

        $data = array_merge($this->validBookingData, [
            'errand_type_id' => $inactiveType->id,
        ]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['errand_type_id']);
    }

    public function test_negotiate_booking_rejects_offer_below_minimum(): void
    {
        $data = array_merge($this->validBookingData, [
            'pricing_mode' => 'negotiate',
            'vehicle_type_rate' => null,
            'customer_offer' => 10.00,
        ]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['customer_offer']);
    }

    public function test_scheduled_booking_rejects_past_date(): void
    {
        $data = array_merge($this->validBookingData, [
            'schedule_type' => 'scheduled',
            'scheduled_at' => now()->subHour()->toIso8601String(),
        ]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['scheduled_at']);
    }

    public function test_fixed_pricing_requires_vehicle_type(): void
    {
        $data = array_merge($this->validBookingData, [
            'pricing_mode' => 'fixed',
            'vehicle_type_rate' => null,
        ]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['vehicle_type_rate']);
    }

    public function test_unauthenticated_user_cannot_create_booking(): void
    {
        $response = $this->postJson('/api/v1/bookings', $this->validBookingData);

        $response->assertStatus(401);
    }

    public function test_runner_cannot_create_booking(): void
    {
        $runner = User::factory()->create([
            'role' => 'runner',
            'status' => 'active',
        ]);

        $response = $this->actingAs($runner)
            ->postJson('/api/v1/bookings', $this->validBookingData);

        $response->assertStatus(403);
    }
}
