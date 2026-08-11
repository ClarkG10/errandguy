<?php

namespace Tests\Feature\Jobs;

use App\Jobs\BroadcastToRunnersJob;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\User;
use App\Services\MatchingService;
use App\Services\NotificationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Mockery;
use Tests\TestCase;

/**
 * BroadcastToRunnersJob must create exactly ONE 'incoming_request' offer card per
 * (runner, booking), however many times it runs. It is re-dispatched by the admin
 * "stuck errand" rematch (BookingService::adminRematch) and re-run on queue retry
 * / worker crash; notifyInApp() has no dedup, so a re-run previously fanned out a
 * duplicate inbox card to every already-notified runner. (audit v4 reliability)
 */
class BroadcastToRunnersIdempotencyTest extends TestCase
{
    use RefreshDatabase;

    public function test_re_running_the_broadcast_does_not_duplicate_offer_cards(): void
    {
        Event::fake();  // NotificationCreated -> Reverb; don't broadcast in tests.
        Http::fake();   // No runner has a device token, but fake outbound anyway.

        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $booking = Booking::create([
            'booking_number' => 'EG-20260812-BC01',
            'customer_id' => $customer->id, 'errand_type_id' => $errandType->id, 'status' => 'pending',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => 'wallet', 'payment_status' => 'pending', 'is_transportation' => false,
        ]);

        // Runners with NO device token => NotificationService::sendRemotePush
        // returns early before any push HTTP call (hermetic).
        $runners = collect(range(1, 3))->map(fn () => User::factory()->create([
            'role' => 'runner', 'status' => 'active', 'fcm_token' => null,
        ]));

        // The eligibility pipeline (getEligibleRunners) is not under test here;
        // the job's per-(runner,booking) offer idempotency is. Feed a fixed set.
        $matcher = Mockery::mock(MatchingService::class);
        $matcher->shouldReceive('broadcastToRunners')
            ->andReturn($runners->map(fn (User $u) => (object) ['user_id' => $u->id]));

        $job = new BroadcastToRunnersJob($booking->id);
        $job->handle($matcher, app(NotificationService::class));
        // Simulate a queue retry / adminRematch re-dispatch of the SAME booking.
        $job->handle($matcher, app(NotificationService::class));

        $this->assertSame(
            3,
            Notification::where('type', 'incoming_request')
                ->where('data->booking_id', $booking->id)->count(),
            'each runner must have exactly one offer card after a re-run, not two',
        );
    }
}
