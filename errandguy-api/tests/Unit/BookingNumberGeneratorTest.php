<?php

namespace Tests\Unit;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use App\Services\BookingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Every booking_number must come from the single collision-safe generator.
 * The column is UNIQUE (bookings table), so a same-day Str::random(4) clash —
 * which the old inline generation in BookingController produced with no guard —
 * is a hard 500 on booking creation. generateBookingNumber() must retry past an
 * already-taken number instead. (audit v3 reliability)
 */
class BookingNumberGeneratorTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        // Restore the real RNG so the override can't leak into other tests.
        Str::createRandomStringsNormally();
        parent::tearDown();
    }

    private function service(): BookingService
    {
        return app(BookingService::class);
    }

    public function test_generated_number_matches_the_documented_format(): void
    {
        $this->assertMatchesRegularExpression(
            '/^EG-\d{8}-[A-Z0-9]{4}$/',
            $this->service()->generateBookingNumber(),
        );
    }

    public function test_it_retries_past_an_already_taken_number(): void
    {
        $today = now()->format('Ymd');
        $taken = "EG-{$today}-DUP0";
        $this->seedBookingWithNumber($taken);

        // Force the FIRST random draw to collide with the seeded row and the
        // SECOND to be free. If the do/while guard were dropped (back to the old
        // inline generation), the first draw would be returned and a real insert
        // would then hit the unique index and 500.
        Str::createRandomStringsUsingSequence(['dup0', 'uniq']);

        $number = $this->service()->generateBookingNumber();

        $this->assertSame("EG-{$today}-UNIQ", $number);
        $this->assertNotSame($taken, $number);
    }

    private function seedBookingWithNumber(string $bookingNumber): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        Booking::create([
            'booking_number' => $bookingNumber,
            'customer_id' => $customer->id,
            'errand_type_id' => $errandType->id, 'status' => 'pending',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => 'wallet', 'payment_status' => 'pending',
            'is_transportation' => false,
        ]);
    }
}
