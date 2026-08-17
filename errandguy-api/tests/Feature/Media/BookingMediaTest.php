<?php

namespace Tests\Feature\Media;

use App\Http\Controllers\BookingMediaController;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Booking media (chat images, runner completion/receipt photos, item photos)
 * lives on the PRIVATE 'media' disk and is streamed only to a participant of the
 * booking (customer/runner) or an admin — closing the public-disk exposure where
 * a receipt photo or chat image was fetchable by URL alone.
 */
class BookingMediaTest extends TestCase
{
    use RefreshDatabase;

    private function booking(): Booking
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);

        return Booking::create([
            'booking_number' => 'EG-20260813-MED1', 'customer_id' => $customer->id, 'runner_id' => $runner->id,
            'errand_type_id' => $type->id, 'status' => 'in_transit', 'pickup_address' => 'a', 'pickup_lat' => 14.6,
            'pickup_lng' => 120.98, 'dropoff_address' => 'b', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0,
            'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ]);
    }

    private function admin(): AdminUser
    {
        return AdminUser::create([
            'email' => 'ops@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops', 'role' => 'admin', 'is_active' => true,
        ]);
    }

    public function test_upload_helper_stores_on_the_private_disk_and_returns_a_gated_url(): void
    {
        Storage::fake('media');
        Storage::fake('public');
        $booking = $this->booking();

        $url = BookingMediaController::storeAndUrl(
            UploadedFile::fake()->image('receipt.jpg'),
            "booking-photos/{$booking->id}",
        );

        $this->assertStringContainsString("/internal/media/booking-photos/{$booking->id}/", $url);
        $this->assertNotEmpty(Storage::disk('media')->allFiles(), 'file must land on the private media disk');
        $this->assertEmpty(Storage::disk('public')->allFiles(), 'nothing goes to the public disk');
    }

    public function test_only_a_participant_or_admin_can_stream_booking_media(): void
    {
        Storage::fake('media');
        $booking = $this->booking();
        Storage::disk('media')->put($path = "booking-photos/{$booking->id}/proof.jpg", 'IMG');
        $url = route('booking.media', ['path' => $path]);

        // Anonymous → 403.
        $this->get($url)->assertStatus(403);

        // A stranger (neither party) → 403.
        Sanctum::actingAs(User::factory()->create(['role' => 'customer', 'status' => 'active']));
        $this->get($url)->assertStatus(403);

        // The booking's customer → 200.
        Sanctum::actingAs($booking->customer);
        $this->get($url)->assertOk();

        // The booking's runner → 200.
        Sanctum::actingAs($booking->runner);
        $this->get($url)->assertOk();

        // An admin (session guard) → 200.
        $this->actingAs($this->admin(), 'admin');
        $this->get($url)->assertOk();
    }

    public function test_streamed_media_carries_hardening_headers(): void
    {
        Storage::fake('media');
        $booking = $this->booking();
        Storage::disk('media')->put($path = "booking-photos/{$booking->id}/proof.jpg", 'IMG');

        Sanctum::actingAs($booking->customer);
        $response = $this->get(route('booking.media', ['path' => $path]));

        $response->assertOk();
        // These routes are on the `web` group (no api SecurityHeaders), so the
        // private-media response must set its own no-sniff + no-store.
        $this->assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
    }

    public function test_malformed_or_traversal_paths_are_rejected(): void
    {
        $this->actingAs($this->admin(), 'admin');

        // Wrong prefix / traversal / missing segments never reach storage.
        $this->get('/internal/media/etc/passwd')->assertNotFound();
        $this->get('/internal/media/booking-photos/not-a-uuid/x.jpg')->assertNotFound();
        $this->get('/internal/media/kyc-docs/'.\Illuminate\Support\Str::uuid().'/x.jpg')->assertNotFound();
    }
}
