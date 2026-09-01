<?php

namespace Tests\Feature\Jobs;

use App\Events\NotificationCreated;
use App\Jobs\BroadcastToRunnersJob;
use App\Models\Booking;
use App\Models\DeviceToken;
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
 * The negotiate offer fan-out must reach EVERY nearby runner at once.
 *
 * It used to loop per runner — 2 queries plus a blocking Expo HTTP round trip
 * each, up to 200 of them — so the last runner's phone rang tens of seconds
 * after the first (by which time the errand was usually taken) and the job
 * head-of-line-blocked every other queued push. These tests pin the batched
 * shape: one grouped dedup query, one bulk insert, and ceil(devices / 100)
 * Expo requests — while keeping the per-(runner, booking) idempotency and the
 * per-runner Reverb broadcast that the loop guaranteed.
 */
class BroadcastToRunnersFanOutTest extends TestCase
{
    use RefreshDatabase;

    private function makeBooking(string $number = 'EG-20260829-FO01'): Booking
    {
        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        return Booking::create([
            'booking_number' => $number,
            'customer_id' => $customer->id, 'errand_type_id' => $errandType->id, 'status' => 'pending',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'negotiate', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'customer_offer' => 120,
            'payment_method' => 'wallet', 'payment_status' => 'pending', 'is_transportation' => false,
        ]);
    }

    /**
     * The eligibility pipeline (getEligibleRunners) is not under test here; feed
     * the job a fixed audience, exactly as BroadcastToRunnersIdempotencyTest does.
     *
     * @param  array<int,string>  $userIds
     */
    private function matcherReturning(array $userIds): MatchingService
    {
        $matcher = Mockery::mock(MatchingService::class);
        $matcher->shouldReceive('broadcastToRunners')
            ->andReturn(collect($userIds)->map(fn (string $id) => (object) ['user_id' => $id]));

        return $matcher;
    }

    public function test_offer_reaches_every_runner_in_a_single_expo_request(): void
    {
        Event::fake([NotificationCreated::class]);
        Http::fake(['exp.host/*' => Http::response(['data' => []], 200)]);

        $booking = $this->makeBooking();

        $runners = collect(range(1, 3))->map(function (int $i) {
            $runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'fcm_token' => null]);
            DeviceToken::create(['user_id' => $runner->id, 'token' => "ExponentPushToken[r{$i}]"]);

            return $runner;
        });

        (new BroadcastToRunnersJob($booking->id))->handle(
            $this->matcherReturning($runners->pluck('id')->all()),
            app(NotificationService::class),
        );

        // ONE HTTP round trip for the whole audience, not one per runner.
        Http::assertSentCount(1);
        Http::assertSent(function ($req) {
            $to = $req->data()['to'] ?? null;

            return str_contains($req->url(), 'exp.host')
                && is_array($to) && count($to) === 3
                && in_array('ExponentPushToken[r1]', $to, true)
                && in_array('ExponentPushToken[r3]', $to, true);
        });

        // Every runner still gets their own offer card...
        foreach ($runners as $runner) {
            $card = Notification::where('user_id', $runner->id)
                ->where('type', 'incoming_request')
                ->where('data->booking_id', $booking->id)
                ->first();

            $this->assertNotNull($card, 'each runner must get an offer card');
            $this->assertSame($booking->booking_number, $card->data['booking_number']);
            $this->assertSame('negotiate', $card->data['pricing_mode']);
            $this->assertNotNull($card->created_at);
        }

        // ...and their own Reverb broadcast, one per runner as before, with a
        // payload identical to the one a single notifyInApp() would have sent
        // (the bulk-inserted row is hydrated, not cast-on-write).
        Event::assertDispatchedTimes(NotificationCreated::class, 3);
        Event::assertDispatched(NotificationCreated::class, function ($event) use ($booking) {
            $payload = $event->broadcastWith();

            return $payload['type'] === 'incoming_request'
                && $payload['is_read'] === false
                && is_string($payload['created_at'])
                && ($payload['data']['booking_id'] ?? null) === $booking->id;
        });
    }

    public function test_re_running_the_broadcast_still_creates_exactly_one_card_per_runner(): void
    {
        Event::fake([NotificationCreated::class]);
        Http::fake(['exp.host/*' => Http::response(['data' => []], 200)]);

        $booking = $this->makeBooking('EG-20260829-FO02');

        $runners = collect(range(1, 3))->map(function (int $i) {
            $runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'fcm_token' => null]);
            DeviceToken::create(['user_id' => $runner->id, 'token' => "ExponentPushToken[q{$i}]"]);

            return $runner;
        });
        $ids = $runners->pluck('id')->all();

        $job = new BroadcastToRunnersJob($booking->id);
        $job->handle($this->matcherReturning($ids), app(NotificationService::class));
        // Queue retry / worker crash mid-job / admin "stuck errand" re-dispatch.
        $job->handle($this->matcherReturning($ids), app(NotificationService::class));

        $this->assertSame(3, Notification::where('type', 'incoming_request')
            ->where('data->booking_id', $booking->id)->count(),
            'a re-run must not duplicate offer cards');
        Event::assertDispatchedTimes(NotificationCreated::class, 3);
        // The device push IS repeated (a duplicate wake is harmless, a duplicate
        // inbox card is not) — still one batched request per run.
        Http::assertSentCount(2);
    }

    public function test_the_same_runner_listed_twice_gets_one_card(): void
    {
        Event::fake([NotificationCreated::class]);
        Http::fake(['exp.host/*' => Http::response(['data' => []], 200)]);

        $booking = $this->makeBooking('EG-20260829-FO03');
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'fcm_token' => null]);

        (new BroadcastToRunnersJob($booking->id))->handle(
            $this->matcherReturning([$runner->id, $runner->id]),
            app(NotificationService::class),
        );

        $this->assertSame(1, Notification::where('user_id', $runner->id)
            ->where('type', 'incoming_request')->count());
    }

    public function test_expo_fan_out_is_chunked_at_one_hundred_tokens_per_request(): void
    {
        Http::fake(['exp.host/*' => Http::response(['data' => []], 200)]);

        // 150 devices spread over two users → 2 requests (100 + 50), not 150.
        $users = collect(range(1, 2))->map(fn () => User::factory()->create([
            'role' => 'runner', 'status' => 'active', 'fcm_token' => null,
        ]));
        foreach (range(1, 150) as $i) {
            DeviceToken::create([
                'user_id' => $users[$i % 2]->id,
                'token' => "ExponentPushToken[bulk{$i}]",
            ]);
        }

        app(NotificationService::class)->sendRemotePushToMany(
            $users->pluck('id')->all(),
            'New errand nearby',
            'Tap to view the offer.',
            ['type' => 'incoming_request'],
        );

        Http::assertSentCount(2);
        $sizes = [];
        Http::assertSent(function ($req) use (&$sizes) {
            $sizes[] = count($req->data()['to']);

            return true;
        });
        sort($sizes);
        $this->assertSame([50, 100], $sizes);
    }

    public function test_bulk_push_falls_back_to_the_legacy_token_column_only_when_no_device_row(): void
    {
        Http::fake(['exp.host/*' => Http::response(['data' => []], 200)]);

        // Pre-device_tokens user: only the legacy column.
        $legacy = User::factory()->create([
            'role' => 'runner', 'status' => 'active', 'fcm_token' => 'ExponentPushToken[legacy]',
        ]);
        // Migrated user: device row wins, the stale legacy column is ignored.
        $migrated = User::factory()->create([
            'role' => 'runner', 'status' => 'active', 'fcm_token' => 'ExponentPushToken[stale]',
        ]);
        DeviceToken::create(['user_id' => $migrated->id, 'token' => 'ExponentPushToken[fresh]']);

        app(NotificationService::class)->sendRemotePushToMany(
            [$legacy->id, $migrated->id],
            'New errand nearby',
            'Tap to view the offer.',
        );

        Http::assertSentCount(1);
        Http::assertSent(function ($req) {
            $to = $req->data()['to'] ?? [];

            return count($to) === 2
                && in_array('ExponentPushToken[legacy]', $to, true)
                && in_array('ExponentPushToken[fresh]', $to, true)
                && ! in_array('ExponentPushToken[stale]', $to, true);
        });
    }

    public function test_bulk_push_makes_no_request_when_nobody_has_a_device(): void
    {
        Http::fake();

        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'fcm_token' => null]);

        app(NotificationService::class)->sendRemotePushToMany([$runner->id], 'T', 'B');
        app(NotificationService::class)->sendRemotePushToMany([], 'T', 'B');

        Http::assertNothingSent();
    }
}
