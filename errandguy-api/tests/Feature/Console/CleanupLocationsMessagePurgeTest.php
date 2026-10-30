<?php

namespace Tests\Feature\Console;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Message;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The retention purge in errandguy:cleanup-locations: chat messages AND their
 * photos 30+ days after the errand ended (completed, cancelled or unmatched),
 * and inbox notifications after 90 days (an unread SOS notice up to a year).
 * It runs in bounded batches (select ids → delete by key) instead of one
 * correlated-subquery DELETE. (audit M5)
 */
class CleanupLocationsMessagePurgeTest extends TestCase
{
    use RefreshDatabase;

    private function booking(string $status, ?string $completedAt, array $extra = []): Booking
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery-'.uniqid(), 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);

        return Booking::create([
            'booking_number' => 'EG-'.uniqid(), 'customer_id' => $customer->id,
            'errand_type_id' => $type->id, 'status' => $status, 'completed_at' => $completedAt,
            'pickup_address' => 'a', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98,
            'dropoff_address' => 'b', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0,
            'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ] + $extra);
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

    public function test_purges_chats_of_cancelled_and_unmatched_errands_the_same_way(): void
    {
        $oldCancelled = $this->booking('cancelled', null, ['cancelled_at' => now()->subDays(40)]);
        $recentCancelled = $this->booking('cancelled', null, ['cancelled_at' => now()->subDays(3)]);
        $oldUnmatched = $this->booking('no_runner', null);
        Booking::whereKey($oldUnmatched->id)->update(['updated_at' => now()->subDays(40)]);

        $gone = [$this->message($oldCancelled), $this->message($oldUnmatched)];
        $kept = $this->message($recentCancelled);

        $this->artisan('errandguy:cleanup-locations')->assertSuccessful();

        foreach ($gone as $message) {
            $this->assertDatabaseMissing('messages', ['id' => $message->id]);
        }
        $this->assertDatabaseHas('messages', ['id' => $kept->id]);
    }

    public function test_purging_a_chat_deletes_its_photos_too(): void
    {
        Storage::fake('media');
        Storage::fake('public');
        $old = $this->booking('completed', now()->subDays(40)->toDateTimeString());
        $recent = $this->booking('completed', now()->subDays(5)->toDateTimeString());

        foreach ([$old, $recent] as $booking) {
            $path = "chat-images/{$booking->id}/photo.jpg";
            Storage::disk('media')->put($path, 'jpeg');
            Message::create([
                'booking_id' => $booking->id, 'sender_id' => $booking->customer_id,
                'image_url' => route('booking.media', ['path' => $path]), 'is_system' => false,
            ]);
        }
        // A photo sent before media went private, still on the public disk.
        Storage::disk('public')->put("chat-images/{$old->id}/legacy.jpg", 'jpeg');

        $this->artisan('errandguy:cleanup-locations')->assertSuccessful();

        Storage::disk('media')->assertMissing("chat-images/{$old->id}/photo.jpg");
        Storage::disk('public')->assertMissing("chat-images/{$old->id}/legacy.jpg");
        Storage::disk('media')->assertExists("chat-images/{$recent->id}/photo.jpg");
        $this->assertSame(0, Message::where('booking_id', $old->id)->count());
        $this->assertSame(1, Message::where('booking_id', $recent->id)->count());
    }

    public function test_purges_inbox_notifications_after_90_days_but_keeps_an_unread_sos_notice(): void
    {
        $user = User::factory()->create();
        $notice = fn (array $attrs) => Notification::create(array_merge([
            'user_id' => $user->id, 'title' => 't', 'body' => 'b', 'type' => 'booking_update', 'is_read' => false,
        ], $attrs));

        $old = $notice([]);
        $recent = $notice([]);
        $oldReadSos = $notice(['type' => 'sos', 'is_read' => true]);
        $oldUnreadSos = $notice(['type' => 'sos']);
        $ancientUnreadSos = $notice(['type' => 'sos']);

        $stamp = fn (Notification $n, $when) => Notification::whereKey($n->id)->update(['created_at' => $when]);
        $stamp($old, now()->subDays(91));
        $stamp($recent, now()->subDays(30));
        $stamp($oldReadSos, now()->subDays(91));
        $stamp($oldUnreadSos, now()->subDays(91));
        $stamp($ancientUnreadSos, now()->subDays(400));

        $this->artisan('errandguy:cleanup-locations')->assertSuccessful();

        $this->assertDatabaseMissing('notifications', ['id' => $old->id]);
        $this->assertDatabaseHas('notifications', ['id' => $recent->id]);
        $this->assertDatabaseMissing('notifications', ['id' => $oldReadSos->id]);
        $this->assertDatabaseHas('notifications', ['id' => $oldUnreadSos->id]);
        $this->assertDatabaseMissing('notifications', ['id' => $ancientUnreadSos->id]);
    }
}
