<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OnlineToggleTest extends TestCase
{
    use RefreshDatabase;

    private User $runner;
    private RunnerProfile $profile;

    protected function setUp(): void
    {
        parent::setUp();

        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $this->profile = RunnerProfile::create([
            'user_id' => $this->runner->id,
            'verification_status' => 'approved',
            'is_online' => false,
            'preferred_types' => ['delivery'],
            'acceptance_rate' => 100.00,
            'completion_rate' => 100.00,
            'total_errands' => 0,
            'total_earnings' => 0.00,
        ]);
    }

    public function test_approved_runner_can_go_online(): void
    {
        $response = $this->actingAs($this->runner)
            ->putJson('/api/v1/runner/online', [
                'is_online' => true,
                'lat' => 14.5995,
                'lng' => 120.9842,
            ]);

        $response->assertOk()
            ->assertJsonPath('data.is_online', true);

        $this->profile->refresh();
        $this->assertTrue($this->profile->is_online);
        $this->assertEquals('14.5995000', $this->profile->current_lat);
    }

    public function test_runner_can_go_offline(): void
    {
        $this->profile->update(['is_online' => true]);

        $response = $this->actingAs($this->runner)
            ->putJson('/api/v1/runner/online', [
                'is_online' => false,
            ]);

        $response->assertOk()
            ->assertJsonPath('data.is_online', false);
    }

    public function test_unapproved_runner_cannot_go_online(): void
    {
        $this->profile->update(['verification_status' => 'pending']);

        $response = $this->actingAs($this->runner)
            ->putJson('/api/v1/runner/online', [
                'is_online' => true,
                'lat' => 14.5995,
                'lng' => 120.9842,
            ]);

        $response->assertStatus(422)
            ->assertJsonPath('message', 'Your account must be approved before going online.');
    }

    public function test_runner_without_preferred_types_cannot_go_online(): void
    {
        $this->profile->update(['preferred_types' => []]);

        $response = $this->actingAs($this->runner)
            ->putJson('/api/v1/runner/online', [
                'is_online' => true,
                'lat' => 14.5995,
                'lng' => 120.9842,
            ]);

        $response->assertStatus(422)
            ->assertJsonPath('message', 'Please set at least one preferred errand type before going online.');
    }

    public function test_runner_with_active_errand_cannot_go_offline(): void
    {
        $this->profile->update(['is_online' => true]);

        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        Booking::create([
            'booking_number' => 'EG-20260331-TEST',
            'customer_id' => $customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $errandType->id, 'status' => 'accepted',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);

        $response = $this->actingAs($this->runner)
            ->putJson('/api/v1/runner/online', ['is_online' => false]);

        $response->assertStatus(422)
            ->assertJsonPath('message', 'You cannot go offline while you have an active errand.');
    }

    public function test_going_online_requires_location(): void
    {
        $response = $this->actingAs($this->runner)
            ->putJson('/api/v1/runner/online', [
                'is_online' => true,
            ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['lat', 'lng']);
    }

    public function test_customer_cannot_toggle_online(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $response = $this->actingAs($customer)
            ->putJson('/api/v1/runner/online', [
                'is_online' => true,
                'lat' => 14.5995,
                'lng' => 120.9842,
            ]);

        $response->assertStatus(403);
    }
}
