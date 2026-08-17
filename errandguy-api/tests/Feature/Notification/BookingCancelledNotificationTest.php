<?php

namespace Tests\Feature\Notification;

use App\Events\BookingCancelled;
use App\Listeners\SendBookingCancelledNotification;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The BookingCancelled event is reused by customer cancels AND admin/platform
 * cancels (BookingService::adminCancel). The runner-facing notice must therefore
 * stay cause-NEUTRAL — an admin cancelling an in-progress booking must not tell
 * the assigned runner that "the customer" cancelled. (admin-hunt 2026-08-17)
 */
class BookingCancelledNotificationTest extends TestCase
{
    use RefreshDatabase;

    public function test_runner_cancellation_notice_does_not_attribute_the_cause(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);
        $booking = Booking::create([
            'booking_number' => 'EG-20260817-CANC1', 'customer_id' => $customer->id, 'runner_id' => $runner->id,
            'errand_type_id' => $type->id, 'status' => 'in_transit', 'pickup_address' => 'a',
            'pickup_lat' => 14.6, 'pickup_lng' => 120.98, 'dropoff_address' => 'b', 'dropoff_lat' => 14.55,
            'dropoff_lng' => 121.02, 'schedule_type' => 'now', 'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle', 'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50,
            'service_fee' => 15, 'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);

        app(SendBookingCancelledNotification::class)->handle(new BookingCancelled($booking));

        $this->assertDatabaseHas('notifications', [
            'user_id' => $runner->id,
            'body' => 'Errand #EG-20260817-CANC1 has been cancelled.',
        ]);
        $this->assertDatabaseMissing('notifications', [
            'user_id' => $runner->id,
            'body' => 'Errand #EG-20260817-CANC1 has been cancelled by the customer.',
        ]);
    }
}
