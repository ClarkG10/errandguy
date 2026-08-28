<?php

namespace Tests\Feature\Customer;

use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\BookingStop;
use App\Models\ErrandType;
use App\Models\PromoCode;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Services\CacheService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * GET /customer/home is a pure convenience aggregate: the app seeds its
 * EXISTING per-section useQuery caches from this one payload. So the only
 * thing that really has to hold is SHAPE PARITY — every section must be
 * byte-identical to what the individual endpoint puts inside its own `data`
 * envelope for the same user. Drift here doesn't 500, it silently poisons the
 * client's caches (the documented "wallet balance is a number, not an object"
 * class of bug), which is exactly why this test hits both sides.
 */
class CustomerHomeAggregateTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $type;

    protected function setUp(): void
    {
        parent::setUp();

        $this->customer = User::factory()->create([
            'role' => 'customer',
            'status' => 'active',
            'wallet_balance' => 1234.50,
        ]);

        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'x', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);

        ErrandType::create([
            'slug' => 'pabili', 'name' => 'Pabili', 'description' => 'y', 'icon_name' => 'ShoppingBag',
            'base_fee' => 60, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 2,
        ]);

        PromoCode::create([
            'code' => 'HOME10', 'discount_type' => 'percentage', 'discount_value' => 10,
            'min_order' => 0, 'usage_limit' => 100, 'per_user_limit' => 5,
            'valid_from' => now()->subDay(), 'valid_until' => now()->addWeek(), 'is_active' => true,
        ]);

        // One in-flight booking (the "active" section) + a few terminal ones so
        // the recent list is genuinely paginated down to 5.
        //
        // The in-flight one is deliberately fully dressed — assigned runner
        // with a runner profile, a status log, a stop. /bookings/active and
        // /bookings eager-load DIFFERENT relations (runner.runnerProfile +
        // statusLogs + stops vs reviews), and BookingResource emits those
        // fields conditionally on relationLoaded(). So the same booking has two
        // legitimately different serializations, and each aggregate section
        // must match the one its own endpoint ships — which is precisely the
        // drift this test exists to catch.
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $runner->id,
            'verification_status' => 'approved',
            'vehicle_type' => 'motorcycle',
            'vehicle_plate' => 'ABC 1234',
            'is_online' => true,
            'acceptance_rate' => 95,
            'completion_rate' => 99,
            'total_errands' => 12,
            'approved_at' => now()->subMonth(),
        ]);

        $active = $this->makeBooking('in_transit', 0);
        $active->update(['runner_id' => $runner->id]);
        BookingStatusLog::create([
            'booking_id' => $active->id, 'status' => 'in_transit', 'changed_by' => $runner->id,
        ]);
        BookingStop::create([
            'booking_id' => $active->id, 'sequence' => 1, 'address' => 'Stop 1',
            'lat' => 14.55, 'lng' => 120.95,
        ]);

        foreach (range(1, 6) as $i) {
            $this->makeBooking('completed', $i);
        }
    }

    private function makeBooking(string $status, int $i): Booking
    {
        return Booking::create([
            'booking_number' => 'EG-HOME-' . $i,
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->type->id,
            'status' => $status,
            'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.9,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.5, 'dropoff_lng' => 121.0,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ]);
    }

    /** The aggregate, as the app will consume it. */
    private function home(): array
    {
        return $this->actingAs($this->customer)
            ->getJson('/api/v1/customer/home')
            ->assertOk()
            ->json('data');
    }

    // ── shape parity, section by section ────────────────────────────────

    public function test_every_section_matches_its_individual_endpoint(): void
    {
        // errand_types is deliberately served from the SAME SWR cache entry as
        // GET /errand-types, so a naive read-both-and-compare would pass even
        // if the two queries had drifted — whichever ran first would seed the
        // other's read. Bust the key between the two reads so each side really
        // re-runs its own closure and the comparison means something.
        Cache::forget(CacheService::errandTypesKey());
        $individualTypes = $this->getJson('/api/v1/errand-types')->assertOk()->json('data');
        Cache::forget(CacheService::errandTypesKey());

        $home = $this->home();

        $this->assertSame(
            $individualTypes,
            $home['errand_types'],
            'errand_types drifted from GET /errand-types',
        );

        $this->assertSame(
            $this->actingAs($this->customer)->getJson('/api/v1/bookings/active')->assertOk()->json('data'),
            $home['active_booking'],
            'active_booking drifted from GET /bookings/active',
        );

        $this->assertSame(
            $this->actingAs($this->customer)->getJson('/api/v1/bookings?per_page=5')->assertOk()->json('data'),
            $home['recent_bookings'],
            'recent_bookings drifted from GET /bookings?per_page=5',
        );

        // The app's ['wallet','balance'] cache key holds the NUMBER, so the
        // aggregate must expose data.balance itself, not the wrapper object.
        $this->assertSame(
            (float) $this->actingAs($this->customer)->getJson('/api/v1/wallet/balance')->assertOk()->json('data.balance'),
            $home['wallet_balance'],
            'wallet_balance drifted from GET /wallet/balance',
        );

        $this->assertSame(
            $this->actingAs($this->customer)->getJson('/api/v1/promos')->assertOk()->json('data'),
            $home['promos'],
            'promos drifted from GET /promos',
        );

        $this->assertSame(
            $this->actingAs($this->customer)->getJson('/api/v1/user/referral')->assertOk()->json('data'),
            $home['referral'],
            'referral drifted from GET /user/referral',
        );
    }

    public function test_payload_carries_exactly_the_six_sections(): void
    {
        $home = $this->home();

        $this->assertSame(
            ['errand_types', 'active_booking', 'recent_bookings', 'wallet_balance', 'promos', 'referral'],
            array_keys($home),
        );
    }

    public function test_it_returns_the_standard_envelope(): void
    {
        $this->actingAs($this->customer)
            ->getJson('/api/v1/customer/home')
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonStructure(['success', 'data', 'errors', 'meta']);
    }

    // ── the sections themselves ─────────────────────────────────────────

    public function test_wallet_balance_is_a_bare_number(): void
    {
        $home = $this->home();

        $this->assertIsFloat($home['wallet_balance']);
        $this->assertEqualsWithDelta(1234.50, $home['wallet_balance'], 0.001);
    }

    public function test_recent_bookings_is_capped_at_five_regardless_of_client_input(): void
    {
        // 7 bookings exist; the aggregate is a fixed snapshot, so neither
        // per_page nor page may reshape it.
        $this->assertCount(5, $this->home()['recent_bookings']);

        $tampered = $this->actingAs($this->customer)
            ->getJson('/api/v1/customer/home?per_page=100&page=3')
            ->assertOk()
            ->json('data.recent_bookings');

        $this->assertCount(5, $tampered);
        $this->assertSame($this->home()['recent_bookings'], $tampered);
    }

    /**
     * BookingController::index also reads status / errand_type_id / date_from /
     * date_to off the request. The aggregate hands it a purpose-built request,
     * so none of those may leak in from the aggregate's own query string —
     * otherwise a stray param would reshape (or 422) the whole Home payload.
     */
    public function test_booking_filters_on_the_aggregate_cannot_reshape_it(): void
    {
        $baseline = $this->home();

        $filtered = $this->actingAs($this->customer)
            ->getJson('/api/v1/customer/home?status=cancelled&date_from=not-a-date&errand_type_id=nope')
            ->assertOk()
            ->json('data');

        $this->assertSame($baseline['recent_bookings'], $filtered['recent_bookings']);
        $this->assertSame($baseline['active_booking'], $filtered['active_booking']);
    }

    public function test_active_booking_is_null_when_nothing_is_in_flight(): void
    {
        Booking::where('customer_id', $this->customer->id)->update(['status' => 'completed']);

        $home = $this->home();

        $this->assertNull($home['active_booking']);
        $this->assertSame(
            $this->actingAs($this->customer)->getJson('/api/v1/bookings/active')->assertOk()->json('data'),
            $home['active_booking'],
        );
    }

    public function test_empty_sections_stay_arrays_not_null(): void
    {
        $fresh = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        PromoCode::query()->delete();

        $home = $this->actingAs($fresh)->getJson('/api/v1/customer/home')->assertOk()->json('data');

        $this->assertSame([], $home['recent_bookings']);
        $this->assertSame([], $home['promos']);
        $this->assertNull($home['active_booking']);
        $this->assertIsArray($home['referral']);
    }

    // ── gating ──────────────────────────────────────────────────────────

    public function test_it_requires_authentication(): void
    {
        $this->getJson('/api/v1/customer/home')->assertUnauthorized();
    }

    public function test_runners_are_rejected(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $this->actingAs($runner)->getJson('/api/v1/customer/home')->assertForbidden();
    }

    public function test_it_never_leaks_another_customers_data(): void
    {
        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $home = $this->actingAs($other)->getJson('/api/v1/customer/home')->assertOk()->json('data');

        $this->assertSame([], $home['recent_bookings']);
        $this->assertNull($home['active_booking']);
        $this->assertEqualsWithDelta(0.0, $home['wallet_balance'], 0.001);
    }
}
