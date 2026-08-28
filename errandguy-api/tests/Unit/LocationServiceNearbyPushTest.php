<?php

namespace Tests\Unit;

use App\Jobs\SendPushJob;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Services\LocationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * Server-side "your runner is nearby" approach push (LocationService).
 *
 * The customer used to get this cue only from a React effect on the mounted
 * tracking screen, so it died on backgrounding. These tests pin the geofence
 * behaviour that replaced it: arm-then-fire, one push per booking leg, the
 * accuracy gate, and the status→leg pairing.
 */
class LocationServiceNearbyPushTest extends TestCase
{
    use RefreshDatabase;

    private LocationService $service;
    private User $customer;
    private User $runner;

    /** Pickup / drop-off fixtures (~7 km apart, so each is "far" from the other). */
    private const PICKUP = ['lat' => 14.60, 'lng' => 120.98];
    private const DROPOFF = ['lat' => 14.55, 'lng' => 121.02];

    protected function setUp(): void
    {
        parent::setUp();

        Bus::fake([SendPushJob::class]);

        $this->service = app(LocationService::class);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        RunnerProfile::create([
            'user_id' => $this->runner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'preferred_types' => [],
        ]);
    }

    private function makeBooking(string $status, string $slug = 'delivery'): Booking
    {
        $type = ErrandType::firstOrCreate(
            ['slug' => $slug],
            [
                'name' => ucfirst($slug), 'description' => $slug, 'icon_name' => 'Package',
                'base_fee' => 50.00, 'per_km_walk' => 15.00, 'per_km_bicycle' => 12.00,
                'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00, 'min_negotiate_fee' => 30.00,
                'is_active' => true, 'sort_order' => 1,
            ]
        );

        return Booking::create([
            'booking_number' => 'EG-NEARBY-' . strtoupper(substr(md5($status . $slug), 0, 6)),
            'customer_id' => $this->customer->id,
            'runner_id' => $this->runner->id,
            'errand_type_id' => $type->id,
            'status' => $status,
            'pickup_address' => '123 Main',
            'pickup_lat' => self::PICKUP['lat'], 'pickup_lng' => self::PICKUP['lng'],
            'dropoff_address' => '456 Oak',
            'dropoff_lat' => self::DROPOFF['lat'], 'dropoff_lng' => self::DROPOFF['lng'],
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 7.0, 'base_fee' => 50, 'distance_fee' => 70, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 135, 'runner_payout' => 120,
            'is_transportation' => $slug === 'transportation',
        ]);
    }

    /**
     * Pings are throttled to 1 per 5 s per runner (an atomic Cache::add at the
     * top of updateRunnerLocation). Real pings arrive on that cadence; clear
     * ONLY that gate so the approach flags/latches under test survive.
     */
    private function ping(Booking $booking, float $lat, float $lng, ?float $accuracy = 10.0): void
    {
        Cache::forget("runner_location_throttle:{$this->runner->id}");

        $this->service->updateRunnerLocation(
            $this->runner->id,
            ['lat' => $lat, 'lng' => $lng, 'accuracy' => $accuracy],
            $booking->id,
        );
    }

    /**
     * The approach pings the customer received, read off the dispatched jobs
     * rather than the notifications table: this cue is DEVICE-ONLY by design
     * (its in-app surface is the live tracking map, and a persisted "runner is
     * nearby" row is stale clutter once they have arrived), so it deliberately
     * leaves no inbox row to count.
     *
     * @return \Illuminate\Support\Collection<int,SendPushJob>
     */
    private function customerPushes()
    {
        return collect(Bus::dispatched(SendPushJob::class))
            ->filter(fn (SendPushJob $job) => $job->userId === $this->customer->id)
            ->values();
    }

    public function test_approach_to_pickup_pushes_the_customer_once_per_leg(): void
    {
        $booking = $this->makeBooking('heading_to_pickup');

        // ~1.1 km out — arms the pickup leg, notifies nothing.
        $this->ping($booking, 14.61, 120.98);
        $this->assertCount(0, $this->customerPushes(), 'far ping must not notify');

        // ~222 m out — inside the fire radius on an armed leg.
        $this->ping($booking, 14.602, 120.98);

        $pushes = $this->customerPushes();
        $this->assertCount(1, $pushes);
        $this->assertSame('Runner is nearby', $pushes->first()->title);
        $this->assertSame('booking_update', $pushes->first()->data['type']);
        $this->assertSame($booking->id, $pushes->first()->data['booking_id']);
        $this->assertSame('heading_to_pickup', $pushes->first()->data['status']);
        $this->assertSame('pickup', $pushes->first()->data['leg']);
        // Device-only: reaching a customer who isn't looking is the whole point,
        // and the tracking screen already shows the approach live. A persisted
        // row would just be inbox clutter minutes after the runner has gone.
        $this->assertTrue($pushes->first()->remoteOnly);
        $this->assertSame(
            0,
            Notification::where('user_id', $this->customer->id)->count(),
            'the approach ping must not persist an inbox row',
        );

        // Every further ping inside the radius is latched — no push spam.
        $this->ping($booking, 14.6015, 120.98);
        $this->ping($booking, 14.6005, 120.98);
        $this->assertCount(1, $this->customerPushes(), 'latch must hold for the leg');
    }

    public function test_ping_outside_the_fire_radius_never_notifies(): void
    {
        $booking = $this->makeBooking('heading_to_pickup');

        $this->ping($booking, 14.61, 120.98);   // ~1.1 km — arms
        $this->ping($booking, 14.604, 120.98);  // ~444 m — dead band
        $this->ping($booking, 14.6035, 120.98); // ~389 m — dead band

        $this->assertCount(0, $this->customerPushes());
    }

    public function test_leg_that_was_never_armed_does_not_fire(): void
    {
        $booking = $this->makeBooking('heading_to_pickup');

        // Runner's very first ping is already 222 m from pickup (accepted a job
        // next door, or a jittery first fix). No advance warning is possible, so
        // we stay silent rather than burn the one-shot latch on noise.
        $this->ping($booking, 14.602, 120.98);

        $this->assertCount(0, $this->customerPushes());
    }

    public function test_poor_accuracy_ping_inside_the_radius_is_ignored(): void
    {
        $booking = $this->makeBooking('heading_to_pickup');

        $this->ping($booking, 14.61, 120.98);              // arms (good fix)
        $this->ping($booking, 14.602, 120.98, 500.0);      // inside, but ±500 m

        $this->assertCount(0, $this->customerPushes());

        // A trustworthy fix at the same spot still fires — the gate rejects the
        // reading, not the approach.
        $this->ping($booking, 14.602, 120.98, 25.0);
        $this->assertCount(1, $this->customerPushes());
    }

    public function test_drop_off_leg_fires_only_in_transit_and_pickup_stays_silent(): void
    {
        $booking = $this->makeBooking('in_transit');

        // Sitting at the pickup point: ~7 km from drop-off (arms drop-off) and
        // 0 m from pickup — but the pickup leg's status is `heading_to_pickup`,
        // so the pickup copy must NOT fire during transit.
        $this->ping($booking, self::PICKUP['lat'], self::PICKUP['lng']);
        $this->assertCount(0, $this->customerPushes());

        // ~222 m from drop-off.
        $this->ping($booking, 14.552, 121.02);

        $pushes = $this->customerPushes();
        $this->assertCount(1, $pushes);
        $this->assertSame('dropoff', $pushes->first()->data['leg']);
        $this->assertSame('in_transit', $pushes->first()->data['status']);
        $this->assertSame('Your runner is almost at the drop-off location.', $pushes->first()->body);
    }

    public function test_transportation_uses_driver_copy(): void
    {
        $booking = $this->makeBooking('heading_to_pickup', 'transportation');

        $this->ping($booking, 14.61, 120.98);
        $this->ping($booking, 14.602, 120.98);

        $pushes = $this->customerPushes();
        $this->assertCount(1, $pushes);
        $this->assertSame('Driver is nearby', $pushes->first()->title);
        $this->assertSame('Your driver is almost at your pickup point.', $pushes->first()->body);
    }

    public function test_single_location_errand_gets_venue_copy_and_no_dropoff_leg(): void
    {
        $booking = $this->makeBooking('heading_to_pickup', 'bills_payment');
        // Single-location errands carry no drop-off coords in practice.
        $booking->forceFill(['dropoff_lat' => null, 'dropoff_lng' => null])->save();

        $this->ping($booking, 14.61, 120.98);
        $this->ping($booking, 14.602, 120.98);

        $pushes = $this->customerPushes();
        $this->assertCount(1, $pushes);
        $this->assertSame('Your runner is almost at the payment center.', $pushes->first()->body);
    }

    public function test_untagged_online_ping_never_notifies(): void
    {
        $this->makeBooking('heading_to_pickup');

        // An idle-online ping carries no booking id — the approach check must
        // not run at all (no booking context, no push).
        Cache::forget("runner_location_throttle:{$this->runner->id}");
        $this->service->updateRunnerLocation($this->runner->id, ['lat' => 14.61, 'lng' => 120.98]);
        Cache::forget("runner_location_throttle:{$this->runner->id}");
        $this->service->updateRunnerLocation($this->runner->id, ['lat' => 14.602, 'lng' => 120.98]);

        $this->assertCount(0, $this->customerPushes());
    }

    public function test_status_outside_the_travel_legs_never_fires(): void
    {
        // `arrived_at_pickup` already has its own manual status push; the
        // approach geofence must not duplicate it.
        $booking = $this->makeBooking('arrived_at_pickup');

        $this->ping($booking, 14.61, 120.98);
        $this->ping($booking, 14.602, 120.98);

        $this->assertCount(0, $this->customerPushes());
    }
}
