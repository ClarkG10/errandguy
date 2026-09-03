<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\BookingStop;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * GET /runner/home is a pure convenience aggregate: the app seeds its EXISTING
 * per-section useQuery caches from this one payload. So the only thing that
 * really has to hold is SHAPE PARITY — every section must be byte-identical to
 * what the individual endpoint puts inside its own `data` envelope for the same
 * runner. Drift here doesn't 500, it silently poisons the client's caches,
 * which is exactly why this test hits both sides.
 *
 * Mirrors {@see \Tests\Feature\Customer\CustomerHomeAggregateTest}.
 */
class RunnerHomeAggregateTest extends TestCase
{
    use RefreshDatabase;

    private User $runner;
    private User $customer;
    private ErrandType $type;

    protected function setUp(): void
    {
        parent::setUp();

        // Freeze mid-week (2026-03-04 is a Wednesday) so "today" and "this
        // week" are genuinely different windows no matter when the suite runs
        // — otherwise on a Monday the two earnings sections would be identical
        // and the parity assertions would prove nothing.
        $this->travelTo(Carbon::parse('2026-03-04 10:00:00'));

        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        RunnerProfile::create([
            'user_id' => $this->runner->id,
            'verification_status' => 'approved',
            'vehicle_type' => 'motorcycle',
            'vehicle_plate' => 'ABC 1234',
            'is_online' => true,
            'current_lat' => 14.60,
            'current_lng' => 120.98,
            'preferred_types' => [],
            'acceptance_rate' => 95,
            'completion_rate' => 99,
            'total_errands' => 12,
            'approved_at' => now()->subMonth(),
        ]);

        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        // The in-flight errand (the `current_errand` section). Deliberately
        // fully dressed — status logs + stops — because current() eager-loads
        // relations that /runner/errands/history does NOT, and BookingResource
        // emits those fields conditionally on relationLoaded(). The same
        // booking therefore has two legitimately different serializations, and
        // each section must match the one its own endpoint ships. `matched`
        // also exercises attachPickupDistance().
        $current = $this->makeBooking('EG-RH-CUR', [
            'status' => 'matched',
            'runner_id' => $this->runner->id,
            'matched_at' => now(),
        ], now()->subMinutes(5));
        BookingStatusLog::create([
            'booking_id' => $current->id, 'status' => 'matched', 'changed_by' => $this->runner->id,
        ]);
        BookingStop::create([
            'booking_id' => $current->id, 'sequence' => 1, 'address' => 'Stop 1',
            'lat' => 14.55, 'lng' => 120.95,
        ]);

        // Terminal errands — five completed so the recent list is genuinely
        // paginated down to three, plus one cancelled (history includes both).
        // Distinct created_at values: history orders by created_at DESC, and
        // identical timestamps would make the ordering — and therefore the
        // parity comparison — non-deterministic.
        foreach (range(1, 5) as $i) {
            $this->makeBooking('EG-RH-DONE-' . $i, [
                'status' => 'completed',
                'runner_id' => $this->runner->id,
                // One inside today's window, the rest earlier in the same week,
                // so earnings_today and earnings_week are different numbers.
                'completed_at' => $i === 1 ? now()->subHour() : now()->startOfWeek()->addHours(9 + $i),
                'runner_payout' => 80 + $i,
            ], now()->subDays($i));
        }
        $this->makeBooking('EG-RH-CANX', [
            'status' => 'cancelled',
            'runner_id' => $this->runner->id,
            'cancelled_at' => now()->subDays(6),
        ], now()->subDays(6));

        // Two open negotiate offers near the runner (the `available_errands`
        // section), at different distances so the nearest-first sort is stable.
        $this->makeOffer('EG-RH-OFF-1', 14.601, 120.981, now()->subMinutes(3));
        $this->makeOffer('EG-RH-OFF-2', 14.630, 121.010, now()->subMinutes(2));
    }

    /** @param array<string,mixed> $overrides */
    private function makeBooking(string $number, array $overrides, Carbon $createdAt): Booking
    {
        $booking = Booking::create(array_merge([
            'booking_number' => $number,
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->type->id,
            'status' => 'pending',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ], $overrides));

        // created_at is not fillable; set it without touching timestamps so the
        // history ordering is deterministic.
        Booking::withoutTimestamps(
            fn () => Booking::whereKey($booking->id)->update(['created_at' => $createdAt]),
        );

        return $booking->refresh();
    }

    private function makeOffer(string $number, float $lat, float $lng, Carbon $createdAt): Booking
    {
        return $this->makeBooking($number, [
            'status' => 'pending',
            'pricing_mode' => 'negotiate',
            'negotiate_expires_at' => now()->addHour(),
            'pickup_lat' => $lat,
            'pickup_lng' => $lng,
        ], $createdAt);
    }

    /** The aggregate, as the app will consume it. */
    private function home(string $query = ''): array
    {
        return $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/home' . $query)
            ->assertOk()
            ->json('data');
    }

    // ── shape parity, section by section ────────────────────────────────

    public function test_every_section_matches_its_individual_endpoint(): void
    {
        // peak-hours is deliberately served from the SAME SWR cache entry as
        // GET /runner/peak-hours (`runner:peak_hours:v2:30`), so a naive
        // read-both-and-compare would pass even if the two calls had drifted —
        // whichever ran first would seed the other's read. Bust the key between
        // the two reads so each side really re-runs its own closure. (Keep this
        // in step with HeatmapController's cache key if it is versioned again.)
        Cache::forget('runner:peak_hours:v2:30');
        $individualPeak = $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/peak-hours')->assertOk()->json('data');
        Cache::forget('runner:peak_hours:v2:30');

        $home = $this->home();

        $this->assertSame(
            $this->actingAs($this->runner)->getJson('/api/v1/runner/profile')->assertOk()->json('data'),
            $home['profile'],
            'profile drifted from GET /runner/profile',
        );

        $this->assertSame(
            $this->actingAs($this->runner)->getJson('/api/v1/runner/earnings?period=today')->assertOk()->json('data'),
            $home['earnings_today'],
            'earnings_today drifted from GET /runner/earnings?period=today',
        );

        $this->assertSame(
            $this->actingAs($this->runner)->getJson('/api/v1/runner/earnings?period=this_week')->assertOk()->json('data'),
            $home['earnings_week'],
            'earnings_week drifted from GET /runner/earnings?period=this_week',
        );

        $this->assertSame(
            $this->actingAs($this->runner)->getJson('/api/v1/runner/errands/history?per_page=3')->assertOk()->json('data'),
            $home['recent_errands'],
            'recent_errands drifted from GET /runner/errands/history?per_page=3',
        );

        $this->assertSame(
            $this->actingAs($this->runner)->getJson('/api/v1/runner/errand/available')->assertOk()->json('data'),
            $home['available_errands'],
            'available_errands drifted from GET /runner/errand/available',
        );

        $this->assertSame(
            $this->actingAs($this->runner)->getJson('/api/v1/runner/errand/current')->assertOk()->json('data'),
            $home['current_errand'],
            'current_errand drifted from GET /runner/errand/current',
        );

        $this->assertSame(
            $individualPeak,
            $home['peak_hours'],
            'peak_hours drifted from GET /runner/peak-hours',
        );
    }

    public function test_payload_carries_exactly_the_seven_sections(): void
    {
        $this->assertSame(
            [
                'profile',
                'earnings_today',
                'earnings_week',
                'recent_errands',
                'available_errands',
                'current_errand',
                'peak_hours',
            ],
            array_keys($this->home()),
        );
    }

    public function test_it_returns_the_standard_envelope(): void
    {
        $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/home')
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonStructure(['success', 'data', 'errors', 'meta']);
    }

    // ── the sections themselves ─────────────────────────────────────────

    public function test_the_sections_are_not_empty_for_a_working_runner(): void
    {
        $home = $this->home();

        $this->assertNotEmpty($home['profile']);
        $this->assertCount(3, $home['recent_errands']);
        $this->assertCount(2, $home['available_errands']);
        $this->assertSame('EG-RH-CUR', $home['current_errand']['booking_number']);
        $this->assertCount(7, $home['peak_hours']['grid']);
        $this->assertSame(30, $home['peak_hours']['days']);
    }

    /**
     * Today's window is a strict subset of this week's, so the two sections
     * must NOT be the same object — the very bug that a single shared request
     * (or a copy-pasted period) would produce.
     */
    public function test_the_two_earnings_periods_are_genuinely_different_windows(): void
    {
        $home = $this->home();

        $this->assertSame('today', $home['earnings_today']['period']);
        $this->assertSame('this_week', $home['earnings_week']['period']);
        $this->assertSame(1, $home['earnings_today']['total_errands']);
        $this->assertSame(5, $home['earnings_week']['total_errands']);
        $this->assertGreaterThan(
            $home['earnings_today']['total_earnings'],
            $home['earnings_week']['total_earnings'],
        );
    }

    /**
     * available() returns [] for an OFFLINE runner. The key must still be
     * present and seeded with that empty list — omitting it would leave the
     * client's ['runner','errand','available',userId] cache a miss and cost the
     * screen the round trip this endpoint exists to save.
     */
    public function test_available_errands_is_a_seeded_empty_array_when_offline(): void
    {
        $this->runner->runnerProfile->update(['is_online' => false]);

        $home = $this->home();

        $this->assertArrayHasKey('available_errands', $home);
        $this->assertSame([], $home['available_errands']);
        $this->assertSame(
            $this->actingAs($this->runner)->getJson('/api/v1/runner/errand/available')->assertOk()->json('data'),
            $home['available_errands'],
        );
    }

    public function test_current_errand_is_null_when_nothing_is_in_flight(): void
    {
        Booking::where('runner_id', $this->runner->id)->update(['status' => 'completed']);

        $home = $this->home();

        $this->assertNull($home['current_errand']);
        $this->assertSame(
            $this->actingAs($this->runner)->getJson('/api/v1/runner/errand/current')->assertOk()->json('data'),
            $home['current_errand'],
        );
    }

    public function test_empty_sections_stay_arrays_not_null(): void
    {
        $fresh = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $home = $this->actingAs($fresh)->getJson('/api/v1/runner/home')->assertOk()->json('data');

        $this->assertSame([], $home['recent_errands']);
        $this->assertSame([], $home['available_errands']);
        $this->assertNull($home['current_errand']);
        // show() auto-creates a runner profile, exactly as GET /runner/profile does.
        $this->assertIsArray($home['profile']);
        // ...and exactly ONCE: both the profile and the earnings delegates
        // auto-create a missing runner_profiles row, off the same cached
        // relation. A stale relation would make the second one insert a
        // duplicate and 500 the whole dashboard on a brand-new runner.
        $this->assertSame(1, RunnerProfile::where('user_id', $fresh->id)->count());
    }

    // ── the aggregate's own query string may never reshape a section ────

    public function test_recent_errands_is_capped_at_three_regardless_of_client_input(): void
    {
        $baseline = $this->home();
        $this->assertCount(3, $baseline['recent_errands']);

        $tampered = $this->home('?per_page=100&page=3');

        $this->assertCount(3, $tampered['recent_errands']);
        $this->assertSame($baseline['recent_errands'], $tampered['recent_errands']);
    }

    public function test_earnings_periods_are_pinned_server_side(): void
    {
        $baseline = $this->home();

        $tampered = $this->home('?period=this_month');

        $this->assertSame($baseline['earnings_today'], $tampered['earnings_today']);
        $this->assertSame($baseline['earnings_week'], $tampered['earnings_week']);
    }

    public function test_peak_hours_window_is_pinned_to_thirty_days(): void
    {
        $baseline = $this->home();

        $tampered = $this->home('?days=1');

        $this->assertSame(30, $tampered['peak_hours']['days']);
        $this->assertSame($baseline['peak_hours'], $tampered['peak_hours']);
    }

    /**
     * The delegates validate their own filters (a malformed date_from is a 422
     * on /runner/earnings and /runner/errands/history). A stray param on the
     * aggregate must not be able to 422 — or reshape — the whole dashboard.
     */
    public function test_malformed_filters_on_the_aggregate_cannot_break_it(): void
    {
        $baseline = $this->home();

        $filtered = $this->home('?status=cancelled&date_from=not-a-date&errand_type_id=nope&search=zzz');

        $this->assertSame($baseline['recent_errands'], $filtered['recent_errands']);
        $this->assertSame($baseline['earnings_today'], $filtered['earnings_today']);
        $this->assertSame($baseline['earnings_week'], $filtered['earnings_week']);
    }

    // ── gating ──────────────────────────────────────────────────────────

    public function test_it_requires_authentication(): void
    {
        $this->getJson('/api/v1/runner/home')->assertUnauthorized();
    }

    public function test_customers_are_rejected(): void
    {
        $this->actingAs($this->customer)->getJson('/api/v1/runner/home')->assertForbidden();
    }

    public function test_it_never_leaks_another_runners_data(): void
    {
        $other = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $other->id,
            'verification_status' => 'approved',
            'is_online' => false,
            'preferred_types' => [],
        ]);

        $home = $this->actingAs($other)->getJson('/api/v1/runner/home')->assertOk()->json('data');

        $this->assertSame([], $home['recent_errands']);
        $this->assertNull($home['current_errand']);
        $this->assertSame(0, $home['earnings_today']['total_errands']);
        $this->assertSame(0, $home['earnings_week']['total_errands']);
    }
}
