<?php

namespace Tests\Feature\Chat;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Message;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MessageTest extends TestCase
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
            'booking_number' => 'EG-20260331-CHAT',
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $errandType->id, 'status' => 'accepted',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);
    }

    public function test_customer_can_send_message(): void
    {
        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/chat/{$this->booking->id}/messages", [
                'content' => 'Hello runner!',
            ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.content', 'Hello runner!');

        $this->assertDatabaseHas('messages', [
            'booking_id' => $this->booking->id,
            'sender_id' => $this->customer->id,
            'content' => 'Hello runner!',
        ]);
    }

    public function test_runner_can_send_message(): void
    {
        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/chat/{$this->booking->id}/messages", [
                'content' => 'On my way!',
            ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.content', 'On my way!');
    }

    public function test_non_participant_cannot_send_message(): void
    {
        $outsider = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $response = $this->actingAs($outsider)
            ->postJson("/api/v1/chat/{$this->booking->id}/messages", [
                'content' => 'I should not be here',
            ]);

        $response->assertStatus(403);
    }

    public function test_cannot_send_message_on_completed_booking(): void
    {
        $this->booking->update(['status' => 'completed']);

        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/chat/{$this->booking->id}/messages", [
                'content' => 'Too late',
            ]);

        $response->assertStatus(422)
            ->assertJsonPath('message', 'Cannot send messages on a closed booking.');
    }

    public function test_message_requires_content_or_image(): void
    {
        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/chat/{$this->booking->id}/messages", []);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['content']);
    }

    public function test_can_send_image_message(): void
    {
        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/chat/{$this->booking->id}/messages", [
                'image_url' => 'https://example.com/photo.jpg',
            ]);

        $response->assertStatus(201);
    }

    public function test_customer_can_view_messages(): void
    {
        Message::create([
            'booking_id' => $this->booking->id,
            'sender_id' => $this->customer->id,
            'content' => 'First message',
            'is_system' => false,
        ]);

        Message::create([
            'booking_id' => $this->booking->id,
            'sender_id' => $this->runner->id,
            'content' => 'Reply',
            'is_system' => false,
        ]);

        $response = $this->actingAs($this->customer)
            ->getJson("/api/v1/chat/{$this->booking->id}/messages");

        $response->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_mark_messages_as_read(): void
    {
        Message::create([
            'booking_id' => $this->booking->id,
            'sender_id' => $this->runner->id,
            'content' => 'Unread message',
            'is_system' => false,
        ]);

        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/chat/{$this->booking->id}/read");

        $response->assertOk();

        $message = Message::first();
        $this->assertNotNull($message->read_at);
    }
}
