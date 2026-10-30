<?php

namespace Tests\Feature\Booking;

use App\Jobs\ExpireStaleMatchesJob;
use App\Jobs\MatchRunnerJob;
use App\Models\AdminAlert;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\RunnerProfile;
use App\Models\SystemConfig;
use App\Models\User;
use App\Services\MatchingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * An errand that is declined or ignored must not bounce between the same few
 * runners forever. Only the last runner used to be skipped, and the auto-cancel
 * skips a booking while a runner holds the offer, so two runners who kept
 * declining (or ignoring) could pass it back and forth indefinitely while the
 * customer's money sat locked. Now every runner who was offered it is skipped
 * for good, and a round of offers is capped — then it ends as "no runner" with
 * the usual refund.
 */
class OfferBounceTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $type;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        SystemConfig::setValue('auto_cancel_timeout_minutes', '30');
        // Keep the side effects of each match (push + live offer) out of the
        // way; matching itself runs for real on the sync queue.
        Event::fake();

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 0]);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function runner(float $lat): User
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'vehicle_type' => 'motorcycle', 'current_lat' => $lat, 'current_lng' => 120.98,
            'last_location_at' => now(), 'preferred_types' => [],
        ]);

        return $runner;
    }

    private function booking(string $method = 'wallet', array $overrides = []): Booking
    {
        $booking = Booking::create(array_merge([
            'booking_number' => 'EG-BNC-'.strtoupper(substr(md5(uniqid('', true)), 0, 6)),
            'customer_id' => $this->customer->id, 'errand_type_id' => $this->type->id,
            'status' => 'pending',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => $method, 'payment_status' => $method === 'cash' ? 'unpaid' : 'paid',
            'is_transportation' => false,
        ], $overrides));

        if ($method !== 'cash') {
            Payment::create([
                'booking_id' => $booking->id, 'customer_id' => $this->customer->id,
                'amount' => 115, 'method' => $method, 'status' => 'completed', 'paid_at' => now(),
            ]);
        }

        return $booking;
    }

    private function decline(User $runner, Booking $booking): void
    {
        $this->actingAs($runner)->postJson("/api/v1/runner/errand/{$booking->id}/decline")->assertOk();
    }

    /** Let the current runner's offer lapse, exactly as the scheduled sweep does. */
    private function ignore(Booking $booking): void
    {
        $booking->update(['matched_at' => now()->subMinutes(5)]);
        (new ExpireStaleMatchesJob())->handle();
    }

    public function test_a_declined_errand_is_never_offered_back_to_the_runner_who_declined(): void
    {
        $nearest = $this->runner(14.6001);
        $next = $this->runner(14.6100);
        $booking = $this->booking();

        MatchRunnerJob::dispatchSync($booking->id);
        $this->assertSame($nearest->id, $booking->fresh()->runner_id);

        $this->decline($nearest, $booking);

        $fresh = $booking->fresh();
        $this->assertSame('matched', $fresh->status);
        $this->assertSame($next->id, $fresh->runner_id, 'the decliner is still nearest, but must be skipped');
        $this->assertEqualsCanonicalizing([$nearest->id, $next->id], $fresh->offered_runner_ids);
        $this->assertSame(2, $fresh->offer_count);
    }

    public function test_two_runners_can_no_longer_pass_an_errand_back_and_forth(): void
    {
        // One declines, the other ignores it. Before, the first was offered it
        // again (only the LAST runner was skipped) and the loop never ended.
        // Now nobody is left, so it ends as no runner and the money comes back.
        $a = $this->runner(14.6001);
        $b = $this->runner(14.6100);
        $booking = $this->booking();

        MatchRunnerJob::dispatchSync($booking->id);
        $this->assertSame($a->id, $booking->fresh()->runner_id);

        $this->decline($a, $booking);
        $this->assertSame($b->id, $booking->fresh()->runner_id);

        $this->ignore($booking);

        $fresh = $booking->fresh();
        $this->assertSame('no_runner', $fresh->status);
        $this->assertNull($fresh->runner_id);
        $this->assertSame('refunded', $fresh->payment_status);
        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_a_round_of_offers_is_capped_then_ends_as_no_runner_with_a_refund(): void
    {
        SystemConfig::setValue('matching_max_offers', '5');
        $runners = collect(range(1, 6))->map(fn ($i) => $this->runner(14.6000 + $i / 1000));
        $booking = $this->booking();

        MatchRunnerJob::dispatchSync($booking->id);
        for ($offer = 1; $offer < 5; $offer++) {
            $this->decline(User::find($booking->fresh()->runner_id), $booking);
        }

        // Five different runners have now been offered it; the fifth declines.
        $fresh = $booking->fresh();
        $this->assertSame(5, $fresh->offer_count);
        $this->assertCount(5, array_unique($fresh->offered_runner_ids));
        $this->decline(User::find($fresh->runner_id), $booking);

        // A sixth runner is online and free, but the round is over.
        $this->assertNotNull(app(MatchingService::class)->findRunner($booking->id));
        $fresh = $booking->fresh();
        $this->assertSame('no_runner', $fresh->status);
        $this->assertSame('refunded', $fresh->payment_status);
        $this->assertDatabaseHas('booking_status_logs', [
            'booking_id' => $booking->id,
            'status' => 'no_runner',
            'note' => 'No runner accepted after 5 offers',
        ]);
        $this->assertTrue(AdminAlert::where('type', 'no_runner')->where('subject_id', $booking->id)->exists());
        $this->assertNotContains($runners->last()->id, $fresh->offered_runner_ids);
    }

    public function test_a_customer_retry_starts_a_fresh_round_but_still_skips_who_declined(): void
    {
        SystemConfig::setValue('matching_max_offers', '1');
        $decliner = $this->runner(14.6001);
        $other = $this->runner(14.6100);
        // Cash: nothing was collected up front, so the customer may retry.
        $booking = $this->booking('cash');

        MatchRunnerJob::dispatchSync($booking->id);
        $this->decline($decliner, $booking);
        $this->assertSame('no_runner', $booking->fresh()->status, 'a one-offer round ends after one decline');

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/retry-match")
            ->assertOk();

        $fresh = $booking->fresh();
        $this->assertSame('matched', $fresh->status);
        $this->assertSame($other->id, $fresh->runner_id);
        $this->assertSame(1, $fresh->offer_count);
    }
}
