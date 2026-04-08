<?php

namespace Tests\Feature\Safety;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\SOSAlert;
use App\Models\User;
use App\Services\NotificationService;
use App\Services\RealtimeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

class SOSTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();

        // Mock external services
        $this->app->bind(NotificationService::class, function () {
            return Mockery::mock(NotificationService::class)->shouldReceive('sendToTopic')->andReturnNull()->getMock();
        });
        $this->app->bind(RealtimeService::class, function () {
            return Mockery::mock(RealtimeService::class)->shouldReceive('broadcastSOSAlert')->andReturnNull()->getMock();
        });

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        $this->booking = Booking::create([
            'booking_number' => 'EG-20260331-SOS1',
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

    public function test_customer_can_trigger_sos(): void
    {
        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/sos");

        $response->assertStatus(201)
            ->assertJsonStructure(['data', 'message']);

        $this->assertDatabaseHas('sos_alerts', [
            'booking_id' => $this->booking->id,
            'customer_id' => $this->customer->id,
            'status' => 'active',
        ]);

        $this->booking->refresh();
        $this->assertTrue($this->booking->sos_triggered);
    }

    public function test_customer_can_deactivate_sos(): void
    {
        // First trigger
        SOSAlert::create([
            'booking_id' => $this->booking->id,
            'customer_id' => $this->customer->id,
            'runner_id' => $this->runner->id,
            'triggered_at' => now(),
            'status' => 'active',
            'live_link_token' => 'test-token',
            'live_link_expires_at' => now()->addHour(),
        ]);
        $this->booking->update(['sos_triggered' => true]);

        $response = $this->actingAs($this->customer)
            ->deleteJson("/api/v1/bookings/{$this->booking->id}/sos");

        $response->assertOk()
            ->assertJsonPath('message', 'SOS alert deactivated.');

        $alert = SOSAlert::first();
        $this->assertEquals('resolved', $alert->status);
        $this->assertNotNull($alert->resolved_at);
    }

    public function test_non_owner_cannot_trigger_sos(): void
    {
        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $response = $this->actingAs($other)
            ->postJson("/api/v1/bookings/{$this->booking->id}/sos");

        $response->assertStatus(404);
    }

    public function test_cannot_trigger_sos_on_completed_booking(): void
    {
        $this->booking->update(['status' => 'completed']);

        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/sos");

        $response->assertStatus(404);
    }
}
