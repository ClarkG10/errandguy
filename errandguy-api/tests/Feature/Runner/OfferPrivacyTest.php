<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\BookingStop;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * A runner who has only been OFFERED an errand ('matched') may decline it, so
 * they get no phone numbers — not the customer's, not the pick-up / drop-off
 * contacts', not a stop's — until they accept.
 */
class OfferPrivacyTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'phone' => '09171110000']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'vehicle_type' => 'motorcycle', 'current_lat' => 14.5995, 'current_lng' => 120.9842,
            'preferred_types' => [], 'completion_rate' => 100, 'total_errands' => 0, 'total_earnings' => 0,
        ]);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
        $this->booking = Booking::create([
            'booking_number' => 'EG-OFFER-0001', 'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $type->id, 'status' => 'matched', 'matched_at' => now(),
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'pickup_contact_name' => 'Store clerk', 'pickup_contact_phone' => '09172220000',
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'dropoff_contact_name' => 'Lola', 'dropoff_contact_phone' => '09173330000',
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ]);
        BookingStop::create([
            'booking_id' => $this->booking->id, 'sequence' => 1, 'address' => '789 Pine',
            'lat' => 14.54, 'lng' => 121.03, 'contact_name' => 'Tito', 'contact_phone' => '09174440000',
        ]);
    }

    private function assertNoPhones(array $data): void
    {
        $this->assertNull($data['customer']['phone'] ?? null, 'the customer’s phone');
        $this->assertNull($data['pickup_contact_phone'], 'the pick-up contact’s phone');
        $this->assertNull($data['dropoff_contact_phone'], 'the drop-off contact’s phone');
        $this->assertNull($data['stops'][0]['contact_phone'], 'a stop contact’s phone');
    }

    public function test_an_offered_runner_sees_no_phone_numbers(): void
    {
        $current = $this->actingAs($this->runner)->getJson('/api/v1/runner/errand/current')->assertOk()->json('data');
        $this->assertSame('matched', $current['status']);
        $this->assertNoPhones($current);

        $shown = $this->actingAs($this->runner)->getJson("/api/v1/runner/errand/{$this->booking->id}")->assertOk()->json('data');
        $this->assertNoPhones($shown);

        $home = $this->actingAs($this->runner)->getJson('/api/v1/runner/home')->assertOk()->json('data.current_errand');
        $this->assertNoPhones($home);

        // Still enough to decide: where, and how much.
        $this->assertSame('123 Main', $current['pickup_address']);
        $this->assertNotNull($current['runner_payout']);
    }

    public function test_the_phones_appear_once_the_runner_accepts(): void
    {
        Event::fake();

        $accepted = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept")
            ->assertOk()
            ->json('data');

        $this->assertSame('accepted', $accepted['status']);
        $this->assertSame('09171110000', $accepted['customer']['phone']);
        $this->assertSame('09172220000', $accepted['pickup_contact_phone']);
        $this->assertSame('09173330000', $accepted['dropoff_contact_phone']);

        $current = $this->actingAs($this->runner)->getJson('/api/v1/runner/errand/current')->assertOk()->json('data');
        $this->assertSame('09174440000', $current['stops'][0]['contact_phone']);
    }

    public function test_the_customer_still_sees_their_own_contacts_while_a_runner_is_offered(): void
    {
        $data = $this->actingAs($this->customer)->getJson("/api/v1/bookings/{$this->booking->id}")->assertOk()->json('data');

        $this->assertSame('09172220000', $data['pickup_contact_phone']);
        $this->assertSame('09173330000', $data['dropoff_contact_phone']);
    }
}
