<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CONTRACT-1 regression: BookingResource must expose sos_triggered so a
 * participant's app can rehydrate the SOS-active banner after a reload/poll.
 * The mobile runner + customer screens read booking.sos_triggered; before this
 * the resource never emitted it, so the restore effect was dead code.
 */
class SosStateResourceTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50.00, 'per_km_walk' => 15.00, 'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00,
            'per_km_car' => 18.00, 'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeBooking(bool $sos): Booking
    {
        return Booking::create([
            'booking_number' => 'EG-'.substr(uniqid(), -10),
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'in_transit',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 100, 'is_transportation' => false,
            'sos_triggered' => $sos,
        ]);
    }

    public function test_participant_sees_active_sos_state(): void
    {
        $booking = $this->makeBooking(sos: true);

        $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$booking->id}")
            ->assertOk()
            ->assertJsonPath('data.sos_triggered', true);
    }

    public function test_participant_sees_inactive_sos_state_as_false(): void
    {
        $booking = $this->makeBooking(sos: false);

        $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$booking->id}")
            ->assertOk()
            ->assertJsonPath('data.sos_triggered', false);
    }

    public function test_non_participant_does_not_see_sos_state(): void
    {
        // TEST-2: sos_triggered is participant/admin-gated. A non-participant
        // (e.g. an online runner receiving this resource in the available-jobs
        // broadcast) must NOT see it — the when() gate omits the key entirely.
        $booking = $this->makeBooking(sos: true);
        $stranger = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $request = \Illuminate\Http\Request::create("/api/v1/bookings/{$booking->id}", 'GET');
        $request->setUserResolver(fn () => $stranger);
        $this->app->instance('request', $request);

        // response() runs the full when()-filtering pipeline (toArray() alone
        // would leave a MissingValue placeholder in place).
        $data = (new \App\Http\Resources\BookingResource($booking->fresh()))
            ->response($request)->getData(true)['data'];

        $this->assertArrayNotHasKey('sos_triggered', $data, 'a non-participant must not see SOS state');
    }
}
