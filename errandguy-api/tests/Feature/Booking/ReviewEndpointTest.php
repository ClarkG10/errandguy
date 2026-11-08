<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use App\Support\ErrorCode;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * POST /bookings/{id}/review. A repeat review stays a 422 (the app treats it
 * as already done — an offline replay lands here) but now carries a code, as
 * every other error does; it used to be a bare {"message"}.
 */
class ReviewEndpointTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    private User $runner;

    private function booking(string $status): Booking
    {
        $type = ErrandType::firstOrCreate(['slug' => 'delivery'], [
            'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package', 'base_fee' => 50,
            'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10, 'per_km_car' => 18,
            'is_active' => true, 'sort_order' => 1,
        ]);

        return Booking::create([
            'booking_number' => 'EG-RV-'.strtoupper(substr(md5(uniqid('', true)), 0, 6)),
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $type->id, 'status' => $status, 'accepted_at' => now()->subHour(),
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0,
            'total_amount' => 140, 'runner_payout' => 125,
            'payment_method' => 'cash', 'payment_status' => 'paid', 'is_transportation' => false,
        ]);
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
    }

    public function test_a_review_lands_once_and_a_repeat_says_why(): void
    {
        $booking = $this->booking('completed');

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/review", ['rating' => 5, 'comment' => 'Quick and careful'])
            ->assertCreated();

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/review", ['rating' => 4])
            ->assertStatus(422)
            ->assertJsonPath('code', ErrorCode::CONFLICT->value)
            ->assertJsonPath('message', 'You have already reviewed this booking.');

        $this->assertSame(5, (int) $this->runner->fresh()->avg_rating);
    }
}
