<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class StatusUpdateTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $errandType;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 0]);

        RunnerProfile::create([
            'user_id' => $this->runner->id,
            'verification_status' => 'approved',
            'is_online' => true,
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
            'booking_number' => 'EG-20260331-STAT',
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'accepted',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);
    }

    public function test_runner_can_update_to_heading_to_pickup(): void
    {
        Event::fake();

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/status", [
                'status' => 'heading_to_pickup',
            ]);

        $response->assertOk()
            ->assertJsonPath('data.status', 'heading_to_pickup');

        $this->assertDatabaseHas('booking_status_logs', [
            'booking_id' => $this->booking->id,
            'status' => 'heading_to_pickup',
        ]);
    }

    public function test_valid_status_progression(): void
    {
        Event::fake();
        Storage::fake('public');

        $statuses = [
            'heading_to_pickup' => [],
            'arrived_at_pickup' => [],
            'picked_up' => ['pickup_photo' => UploadedFile::fake()->image('pickup.jpg')],
            'in_transit' => [],
            'arrived_at_dropoff' => [],
            'delivered' => ['delivery_photo' => UploadedFile::fake()->image('delivery.jpg')],
            'completed' => ['signature' => UploadedFile::fake()->image('signature.png')],
        ];

        foreach ($statuses as $status => $extraData) {
            $response = $this->actingAs($this->runner)
                ->postJson("/api/v1/runner/errand/{$this->booking->id}/status", array_merge(
                    ['status' => $status],
                    $extraData
                ));

            $response->assertOk()
                ->assertJsonPath('data.status', $status);
        }

        $this->booking->refresh();
        $this->assertEquals('completed', $this->booking->status);
        $this->assertNotNull($this->booking->completed_at);
    }

    public function test_invalid_status_transition_rejected(): void
    {
        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/status", [
                'status' => 'in_transit',
            ]);

        $response->assertStatus(422)
            ->assertJsonPath('message', "Invalid status transition from 'accepted' to 'in_transit'.");
    }

    public function test_non_assigned_runner_cannot_update_status(): void
    {
        $otherRunner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $otherRunner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'preferred_types' => [],
        ]);

        $response = $this->actingAs($otherRunner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/status", [
                'status' => 'heading_to_pickup',
            ]);

        $response->assertStatus(403);
    }

    public function test_completion_creates_wallet_transaction(): void
    {
        Event::fake();
        Storage::fake('public');

        // Progress through all statuses to completed
        $statuses = [
            'heading_to_pickup', 'arrived_at_pickup',
            'picked_up', 'in_transit', 'arrived_at_dropoff', 'delivered', 'completed',
        ];

        foreach ($statuses as $status) {
            $data = ['status' => $status];
            if ($status === 'picked_up') $data['pickup_photo'] = UploadedFile::fake()->image('p.jpg');
            if ($status === 'delivered') $data['delivery_photo'] = UploadedFile::fake()->image('d.jpg');
            if ($status === 'completed') $data['signature'] = UploadedFile::fake()->image('s.png');

            $this->actingAs($this->runner)
                ->postJson("/api/v1/runner/errand/{$this->booking->id}/status", $data);
        }

        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->runner->id,
            'type' => 'earning',
            'reference_id' => $this->booking->id,
        ]);

        $this->runner->refresh();
        $this->assertEquals('85.00', $this->runner->wallet_balance);
    }

    public function test_status_update_notifies_customer(): void
    {
        Event::fake();

        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/status", [
                'status' => 'heading_to_pickup',
            ]);

        $this->assertDatabaseHas('notifications', [
            'user_id' => $this->customer->id,
            'type' => 'booking_update',
        ]);
    }

    public function test_status_update_with_location(): void
    {
        Event::fake();

        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/status", [
                'status' => 'heading_to_pickup',
                'lat' => 14.5995,
                'lng' => 120.9842,
                'note' => 'On my way',
            ]);

        $this->assertDatabaseHas('booking_status_logs', [
            'booking_id' => $this->booking->id,
            'status' => 'heading_to_pickup',
            'note' => 'On my way',
        ]);
    }
}
