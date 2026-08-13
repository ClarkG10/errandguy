<?php

namespace Tests\Feature\Console;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Message;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class MigrateBookingMediaToPrivateTest extends TestCase
{
    use RefreshDatabase;

    /** @return array{0:Booking,1:User} */
    private function bookingWithParties(): array
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);
        $booking = Booking::create([
            'booking_number' => 'EG-20260813-BM'.random_int(100, 999), 'customer_id' => $customer->id,
            'runner_id' => $runner->id, 'errand_type_id' => $type->id, 'status' => 'completed',
            'pickup_address' => 'a', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98, 'dropoff_address' => 'b',
            'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02, 'schedule_type' => 'now', 'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle', 'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50,
            'service_fee' => 15, 'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ]);

        return [$booking, $customer];
    }

    public function test_migrates_legacy_public_media_to_the_private_disk_and_gates_the_url(): void
    {
        Storage::fake('public');
        Storage::fake('media');
        [$booking, $customer] = $this->bookingWithParties();

        // Legacy public files + rows.
        $receipt = "booking-photos/{$booking->id}/receipt.jpg";
        $item = "booking-photos/{$booking->id}/item.jpg";
        $chat = "chat-images/{$booking->id}/pic.jpg";
        Storage::disk('public')->put($receipt, 'R');
        Storage::disk('public')->put($item, 'I');
        Storage::disk('public')->put($chat, 'C');
        $booking->update([
            'receipt_photo_url' => Storage::disk('public')->url($receipt),
            'item_photos' => [Storage::disk('public')->url($item)],
        ]);
        $message = Message::create([
            'booking_id' => $booking->id, 'sender_id' => $customer->id,
            'image_url' => Storage::disk('public')->url($chat), 'is_system' => false,
        ]);

        $this->artisan('errandguy:migrate-booking-media-to-private')->assertSuccessful();

        // Files moved to the private disk, public originals gone.
        foreach ([$receipt, $item, $chat] as $p) {
            Storage::disk('media')->assertExists($p);
            Storage::disk('public')->assertMissing($p);
        }
        // URLs rewritten to the gated route.
        $booking->refresh();
        $this->assertStringContainsString('/internal/media/'.$receipt, $booking->receipt_photo_url);
        $this->assertStringContainsString('/internal/media/'.$item, $booking->item_photos[0]);
        $this->assertStringContainsString('/internal/media/'.$chat, $message->fresh()->image_url);
    }

    public function test_dry_run_changes_nothing(): void
    {
        Storage::fake('public');
        Storage::fake('media');
        [$booking] = $this->bookingWithParties();
        $p = "booking-photos/{$booking->id}/x.jpg";
        Storage::disk('public')->put($p, 'X');
        $url = Storage::disk('public')->url($p);
        $booking->update(['signature_url' => $url]);

        $this->artisan('errandguy:migrate-booking-media-to-private', ['--dry-run' => true])->assertSuccessful();

        $this->assertSame($url, $booking->fresh()->signature_url);
        Storage::disk('media')->assertMissing($p);
        Storage::disk('public')->assertExists($p);
    }

    public function test_is_idempotent_and_skips_already_gated_urls(): void
    {
        Storage::fake('public');
        Storage::fake('media');
        [$booking] = $this->bookingWithParties();
        // Already gated (a new upload) — must be left untouched, no public file.
        $gated = route('booking.media', ['path' => "booking-photos/{$booking->id}/new.jpg"]);
        $booking->update(['pickup_photo_url' => $gated]);

        $this->artisan('errandguy:migrate-booking-media-to-private')
            ->expectsOutputToContain('Migrated: 0')
            ->assertSuccessful();

        $this->assertSame($gated, $booking->fresh()->pickup_photo_url);
    }
}
