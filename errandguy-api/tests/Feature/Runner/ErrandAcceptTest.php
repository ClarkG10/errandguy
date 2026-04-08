<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

class ErrandAcceptTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private RunnerProfile $profile;
    private ErrandType $errandType;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $this->profile = RunnerProfile::create([
            'user_id' => $this->runner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'current_lat' => 14.5995,
            'current_lng' => 120.9842,
            'preferred_types' => [],
            'acceptance_rate' => 100.00,
            'completion_rate' => 100.00,
            'total_errands' => 0,
            'total_earnings' => 0.00,
        ]);

        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        $this->booking = Booking::create([
            'booking_number' => 'EG-20260331-ACPT',
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->errandType->id,
            'status' => 'pending',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);
    }

    public function test_runner_can_accept_pending_booking(): void
    {
        Event::fake();

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept");

        $response->assertOk()
            ->assertJsonPath('data.status', 'accepted');

        $this->booking->refresh();
        $this->assertEquals('accepted', $this->booking->status);
        $this->assertEquals($this->runner->id, $this->booking->runner_id);
        $this->assertNotNull($this->booking->accepted_at);
    }

    public function test_runner_can_accept_matched_booking(): void
    {
        Event::fake();
        $this->booking->update(['status' => 'matched']);

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept");

        $response->assertOk()
            ->assertJsonPath('data.status', 'accepted');
    }

    public function test_runner_cannot_accept_already_accepted_booking(): void
    {
        $this->booking->update(['status' => 'accepted', 'runner_id' => $this->runner->id]);

        $otherRunner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $otherRunner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'preferred_types' => [],
        ]);

        $response = $this->actingAs($otherRunner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept");

        $response->assertStatus(422)
            ->assertJsonPath('message', 'This booking is no longer available.');
    }

    public function test_runner_with_active_errand_cannot_accept_another(): void
    {
        Event::fake();

        // Create an active booking for this runner
        Booking::create([
            'booking_number' => 'EG-20260331-ACT2',
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'accepted',
            'pickup_address' => '789 Pine', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '321 Elm', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 3.0, 'base_fee' => 50, 'distance_fee' => 30, 'service_fee' => 12,
            'surcharge' => 0, 'total_amount' => 92, 'runner_payout' => 68,
            'is_transportation' => false,
        ]);

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept");

        $response->assertStatus(422)
            ->assertJsonPath('message', 'You already have an active errand. Complete it first.');
    }

    public function test_offline_runner_cannot_accept(): void
    {
        $this->profile->update(['is_online' => false]);

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept");

        $response->assertStatus(422)
            ->assertJsonPath('message', 'You must be online and approved to accept errands.');
    }

    public function test_acceptance_creates_status_log_and_notification(): void
    {
        Event::fake();

        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept");

        $this->assertDatabaseHas('booking_status_logs', [
            'booking_id' => $this->booking->id,
            'status' => 'accepted',
            'changed_by' => $this->runner->id,
        ]);

        $this->assertDatabaseHas('notifications', [
            'user_id' => $this->customer->id,
            'type' => 'booking_update',
        ]);
    }

    public function test_runner_can_decline_booking(): void
    {
        $this->booking->update(['status' => 'matched', 'runner_id' => $this->runner->id]);

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/decline");

        $response->assertOk()
            ->assertJsonPath('message', 'Errand declined.');
    }

    public function test_runner_can_view_current_errand(): void
    {
        Event::fake();
        $this->booking->update(['status' => 'accepted', 'runner_id' => $this->runner->id]);

        $response = $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/errand/current');

        $response->assertOk()
            ->assertJsonPath('data.id', $this->booking->id);
    }

    public function test_current_returns_null_when_no_active_errand(): void
    {
        $response = $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/errand/current');

        $response->assertOk()
            ->assertJsonPath('data', null);
    }

    public function test_customer_cannot_accept_errand(): void
    {
        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept");

        $response->assertStatus(403);
    }
}
