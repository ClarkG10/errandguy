<?php

namespace Tests\Feature\Console;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Message;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The message-retention purge in errandguy:cleanup-locations deletes messages
 * 30+ days after their booking completed. It runs in bounded batches (select
 * ids → delete by key) instead of one correlated-subquery DELETE; this asserts
 * the batching preserves the exact retention semantics. (audit M5)
 */
class CleanupLocationsMessagePurgeTest extends TestCase
{
    use RefreshDatabase;

    private function booking(string $status, ?string $completedAt): Booking
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery-'.uniqid(), 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);

        return Booking::create([
            'booking_number' => 'EG-'.uniqid(), 'customer_id' => $customer->id,
            'errand_type_id' => $type->id, 'status' => $status, 'completed_at' => $completedAt,
            'pickup_address' => 'a', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98,
            'dropoff_address' => 'b', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0,
            'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ]);
    }

    private function message(Booking $booking): Message
    {
        return Message::create([
            'booking_id' => $booking->id,
            'sender_id' => $booking->customer_id,
            'content' => 'hello',
            'is_system' => false,
        ]);
    }

    public function test_purges_only_messages_from_long_completed_bookings(): void
    {
        $old = $this->booking('completed', now()->subDays(40)->toDateTimeString());
        $recent = $this->booking('completed', now()->subDays(5)->toDateTimeString());
        $active = $this->booking('in_transit', null);

        $oldMsg = $this->message($old);
        $recentMsg = $this->message($recent);
        $activeMsg = $this->message($active);

        $this->artisan('errandguy:cleanup-locations')->assertSuccessful();

        // 30+ days post-completion → gone.
        $this->assertDatabaseMissing('messages', ['id' => $oldMsg->id]);
        // Recently completed + still active → kept.
        $this->assertDatabaseHas('messages', ['id' => $recentMsg->id]);
        $this->assertDatabaseHas('messages', ['id' => $activeMsg->id]);
    }
}
