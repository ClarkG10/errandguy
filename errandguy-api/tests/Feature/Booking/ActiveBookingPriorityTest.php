<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * /bookings/active returns ONE booking, and the customer layout points its
 * single realtime status channel at whatever comes back. Ordering purely by
 * created_at meant a booking scheduled for next week — newer, and 'active' by
 * status for days — outranked the errand that actually had a runner driving
 * towards it: the live card vanished from Home and its realtime updates
 * stopped arriving.
 */
class ActiveBookingPriorityTest extends TestCase
{
    use RefreshDatabase;

    private function makeType(): ErrandType
    {
        return ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'D',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
            'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeBooking(User $customer, ErrandType $type, array $overrides): Booking
    {
        return Booking::create(array_merge([
            'booking_number' => 'EG-A-'.uniqid(),
            'customer_id' => $customer->id,
            'errand_type_id' => $type->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ], $overrides));
    }

    public function test_live_errand_outranks_a_newer_future_scheduled_booking(): void
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $type = $this->makeType();

        $live = $this->makeBooking($customer, $type, ['status' => 'in_transit']);
        $live->forceFill(['created_at' => now()->subHour()])->save();

        // Booked afterwards, for next week — previously this won on created_at.
        $scheduled = $this->makeBooking($customer, $type, [
            'status' => 'pending',
            'schedule_type' => 'scheduled',
            'scheduled_at' => now()->addWeek(),
        ]);

        Sanctum::actingAs($customer);
        $response = $this->getJson('/api/v1/bookings/active')->assertOk();

        $this->assertSame($live->id, $response->json('data.id'));
        $this->assertNotSame($scheduled->id, $response->json('data.id'));
    }

    public function test_scheduled_booking_inside_its_matching_window_ranks_normally(): void
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $type = $this->makeType();

        $older = $this->makeBooking($customer, $type, ['status' => 'pending']);
        $older->forceFill(['created_at' => now()->subHours(2)])->save();

        // Its window is open, so it is genuinely live and may win on recency.
        $dueNow = $this->makeBooking($customer, $type, [
            'status' => 'pending',
            'schedule_type' => 'scheduled',
            'scheduled_at' => now()->addMinutes(5),
        ]);

        Sanctum::actingAs($customer);
        $response = $this->getJson('/api/v1/bookings/active')->assertOk();

        $this->assertSame($dueNow->id, $response->json('data.id'));
    }

    public function test_a_lone_future_scheduled_booking_is_still_returned(): void
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $type = $this->makeType();

        $scheduled = $this->makeBooking($customer, $type, [
            'status' => 'pending',
            'schedule_type' => 'scheduled',
            'scheduled_at' => now()->addWeek(),
        ]);

        Sanctum::actingAs($customer);
        $this->getJson('/api/v1/bookings/active')
            ->assertOk()
            ->assertJsonPath('data.id', $scheduled->id);
    }
}
