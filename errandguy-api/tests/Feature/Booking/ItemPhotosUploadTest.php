<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ItemPhotosUploadTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->errandType = ErrandType::create([
            'slug' => 'purchase', 'name' => 'Purchase', 'description' => 'Buy',
            'icon_name' => 'ShoppingBag', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeBooking(string $number, string $status = 'pending'): Booking
    {
        return Booking::create([
            'booking_number' => $number,
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->errandType->id, 'status' => $status,
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 100,
            'is_transportation' => false,
        ]);
    }

    public function test_owner_can_upload_item_photos_to_a_pending_booking(): void
    {
        Storage::fake('media');
        $booking = $this->makeBooking('EG-20260331-IP001');

        $this->actingAs($this->customer)
            ->post("/api/v1/bookings/{$booking->id}/item-photos", [
                'item_photos' => [
                    UploadedFile::fake()->image('a.jpg'),
                    UploadedFile::fake()->image('b.png'),
                ],
            ])
            ->assertOk();

        $booking->refresh();
        $this->assertIsArray($booking->item_photos);
        $this->assertCount(2, $booking->item_photos);
        // Stored on the private media disk under the booking's folder.
        $this->assertCount(2, Storage::disk('media')->allFiles());
    }

    public function test_non_owner_cannot_upload_item_photos(): void
    {
        Storage::fake('media');
        $booking = $this->makeBooking('EG-20260331-IP002');
        $intruder = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->actingAs($intruder)
            ->post("/api/v1/bookings/{$booking->id}/item-photos", [
                'item_photos' => [UploadedFile::fake()->image('a.jpg')],
            ])
            ->assertForbidden();

        $this->assertCount(0, Storage::disk('media')->allFiles());
    }

    public function test_cannot_upload_item_photos_after_pickup(): void
    {
        Storage::fake('media');
        $booking = $this->makeBooking('EG-20260331-IP003', 'picked_up');

        $this->actingAs($this->customer)
            ->post("/api/v1/bookings/{$booking->id}/item-photos", [
                'item_photos' => [UploadedFile::fake()->image('a.jpg')],
            ])
            ->assertStatus(422);
    }

    public function test_svg_item_photo_is_rejected(): void
    {
        Storage::fake('media');
        $booking = $this->makeBooking('EG-20260331-IP004');

        $this->actingAs($this->customer)
            ->post("/api/v1/bookings/{$booking->id}/item-photos", [
                'item_photos' => [
                    UploadedFile::fake()->create('x.svg', 10, 'image/svg+xml'),
                ],
            ])
            ->assertStatus(422);
    }

    public function test_upload_appends_and_caps_at_five(): void
    {
        Storage::fake('media');
        $booking = $this->makeBooking('EG-20260331-IP005');
        $booking->update(['item_photos' => ['u1', 'u2', 'u3']]);

        $this->actingAs($this->customer)
            ->post("/api/v1/bookings/{$booking->id}/item-photos", [
                'item_photos' => [
                    UploadedFile::fake()->image('a.jpg'),
                    UploadedFile::fake()->image('b.jpg'),
                    UploadedFile::fake()->image('c.jpg'),
                ],
            ])
            ->assertOk();

        $booking->refresh();
        // 3 existing + 3 new = 6, capped to 5.
        $this->assertCount(5, $booking->item_photos);
    }
}
