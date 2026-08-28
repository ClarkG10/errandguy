<?php

namespace Tests\Feature\Notification;

use App\Events\BookingStatusChanged;
use App\Listeners\SendBookingStatusNotification;
use App\Models\Booking;
use App\Models\DeviceToken;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * A standard delivery walks nine templated stages and the runner taps through
 * each one, so the customer's phone used to buzz nine times for a single
 * errand — several saying the same thing seconds apart ('heading_to_pickup'
 * repeats 'accepted' almost verbatim; 'in_transit' repeats 'picked_up';
 * 'delivered' is chased by 'completed'). The alerts that matter, like the
 * runner arriving at the door, drowned in that noise.
 *
 * Quiet stages must still reach the app — persisted inbox row + Reverb
 * broadcast — while leaving the device alone.
 */
class QuietStatusStagesTest extends TestCase
{
    use RefreshDatabase;

    private function bookingWithParties(): Booking
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        DeviceToken::create(['user_id' => $customer->id, 'token' => 'ExponentPushToken[quiet-c]']);

        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'D',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
            'is_active' => true, 'sort_order' => 1,
        ]);

        return Booking::create([
            'booking_number' => 'EG-Q-'.uniqid(),
            'customer_id' => $customer->id,
            'runner_id' => $runner->id,
            'errand_type_id' => $type->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false, 'status' => 'accepted',
        ]);
    }

    private function fire(Booking $booking, string $status): void
    {
        app(SendBookingStatusNotification::class)
            ->handle(new BookingStatusChanged($booking, 'accepted', $status));
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function quietStatuses(): array
    {
        return [
            'matched (accepted follows in seconds)' => ['matched'],
            'heading_to_pickup (repeats accepted)' => ['heading_to_pickup'],
            'in_transit (repeats picked_up)' => ['in_transit'],
            'delivered (completed follows)' => ['delivered'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('quietStatuses')]
    public function test_quiet_stage_records_the_row_without_waking_the_device(string $status): void
    {
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]], 200)]);
        $booking = $this->bookingWithParties();

        $this->fire($booking, $status);

        Http::assertNothingSent();
        $this->assertSame(
            1,
            Notification::where('user_id', $booking->customer_id)->count(),
            "the {$status} stage must still land in the in-app inbox",
        );
    }

    /**
     * The counterpart guard: an actionable stage must still buzz, or this
     * change would have made the app quieter by breaking it.
     */
    public function test_arrival_still_wakes_the_device(): void
    {
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]], 200)]);
        $booking = $this->bookingWithParties();

        $this->fire($booking, 'arrived_at_pickup');

        Http::assertSent(fn ($req) => str_contains($req->url(), 'exp.host'));
        $this->assertSame(1, Notification::where('user_id', $booking->customer_id)->count());
    }

    public function test_completion_still_wakes_the_device(): void
    {
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]], 200)]);
        $booking = $this->bookingWithParties();

        $this->fire($booking, 'completed');

        Http::assertSent(fn ($req) => str_contains($req->url(), 'exp.host'));
    }
}
