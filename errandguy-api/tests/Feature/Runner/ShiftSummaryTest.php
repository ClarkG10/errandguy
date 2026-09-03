<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The shift summary.
 *
 * `is_online` was a bare boolean, so nothing recorded when a shift began and a
 * runner clocked off into silence. To find out what they'd just made they had
 * to open the earnings tab and work out for themselves which rows belonged to
 * the hours they'd worked.
 *
 * The figures mirror RunnerEarningsController::summary exactly — payout summed,
 * tips summed ALONGSIDE it and never into it. There is no worse place to be
 * approximately right than money: a shift card that disagreed with the earnings
 * screen the runner checks next would destroy trust in both.
 */
class ShiftSummaryTest extends TestCase
{
    use RefreshDatabase;

    private User $runner;

    private RunnerProfile $profile;

    private ErrandType $type;

    protected function setUp(): void
    {
        parent::setUp();

        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $this->profile = RunnerProfile::create([
            'user_id' => $this->runner->id,
            'verification_status' => 'approved',
            'preferred_types' => ['delivery'],
            'is_online' => false,
        ]);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'D',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
            'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function completedErrand(float $payout, float $tip, $completedAt): Booking
    {
        $customer = User::factory()->create(['role' => 'customer']);

        $booking = Booking::create([
            'booking_number' => 'EG-S-'.uniqid(),
            'customer_id' => $customer->id,
            'runner_id' => $this->runner->id,
            'errand_type_id' => $this->type->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => $payout,
            'tip_amount' => $tip,
            'is_transportation' => false, 'status' => 'completed',
        ]);
        $booking->forceFill(['completed_at' => $completedAt])->save();

        return $booking;
    }

    private function goOnline(): void
    {
        $this->actingAs($this->runner)
            ->putJson('/api/v1/runner/online', [
                'is_online' => true, 'lat' => 14.6, 'lng' => 121.0,
            ])
            ->assertOk();
    }

    private function goOffline()
    {
        return $this->actingAs($this->runner)
            ->putJson('/api/v1/runner/online', ['is_online' => false]);
    }

    public function test_going_online_stamps_the_shift_start(): void
    {
        $this->goOnline();

        $this->assertNotNull($this->profile->fresh()->online_since);
    }

    /**
     * The app re-asserts online on foreground and on reconnect. Restamping
     * there would silently restart the shift every time the runner switched
     * apps, and the summary would report minutes instead of hours.
     */
    public function test_re_asserting_online_does_not_restart_the_shift(): void
    {
        $this->goOnline();
        $original = $this->profile->fresh()->online_since;

        $this->travel(90)->minutes();
        $this->goOnline();

        $this->assertEquals(
            $original->toIso8601String(),
            $this->profile->fresh()->online_since->toIso8601String(),
        );
    }

    public function test_clocking_off_returns_what_the_shift_amounted_to(): void
    {
        $this->goOnline();
        $this->travel(3)->hours();

        $this->completedErrand(120.00, 20.00, now()->subHours(2));
        $this->completedErrand(80.00, 0.00, now()->subHour());

        $response = $this->goOffline()->assertOk();
        $shift = $response->json('data.shift');

        // Compared numerically, not identically: json_encode emits a whole
        // float as `200`, so asserting 200.0 identically fails on the encoding
        // rather than on the money.
        $this->assertSame(2, $shift['errands']);
        // Payout only — tips are reported SEPARATELY, exactly as the earnings
        // screen does it. Folding them in would corrupt the cash-settlement
        // commission maths this figure reconciles against.
        $this->assertEquals(200.00, $shift['earnings']);
        $this->assertEquals(20.00, $shift['tips']);
        $this->assertSame(180, $shift['minutes_online']);
    }

    /**
     * Yesterday's earnings must not be counted into today's shift — the whole
     * value of this card is that it describes the hours just worked.
     */
    public function test_errands_from_before_the_shift_are_not_counted(): void
    {
        $this->completedErrand(500.00, 50.00, now()->subDays(2));

        $this->goOnline();
        $this->travel(1)->hour();
        $this->completedErrand(90.00, 0.00, now()->subMinutes(10));

        $shift = $this->goOffline()->assertOk()->json('data.shift');

        $this->assertSame(1, $shift['errands']);
        $this->assertEquals(90.00, $shift['earnings']);
        $this->assertEquals(0.00, $shift['tips']);
    }

    public function test_a_shift_with_no_errands_reports_zero_honestly(): void
    {
        $this->goOnline();
        $this->travel(45)->minutes();

        $this->goOffline()
            ->assertOk()
            ->assertJsonPath('data.shift.errands', 0)
            ->assertJsonPath('data.shift.earnings', 0)
            ->assertJsonPath('data.shift.minutes_online', 45);
    }

    /**
     * A runner already online when this column shipped has no start time. Null
     * means "can't measure this honestly" — better than a summary computed from
     * a fabricated start, which would read like a bad day.
     */
    public function test_a_shift_we_cannot_measure_returns_null_rather_than_zeroes(): void
    {
        $this->profile->update(['is_online' => true, 'online_since' => null]);

        $this->goOffline()
            ->assertOk()
            ->assertJsonPath('data.shift', null);
    }

    public function test_clocking_off_clears_the_shift_start(): void
    {
        $this->goOnline();
        $this->goOffline()->assertOk();

        $this->assertNull($this->profile->fresh()->online_since);
        $this->assertFalse((bool) $this->profile->fresh()->is_online);
    }

    /**
     * Pre-existing guard, re-pinned because the summary now runs on this path:
     * it must not be possible to end a shift mid-errand (and thus produce a
     * summary that omits the errand still in progress).
     */
    public function test_a_runner_cannot_clock_off_mid_errand(): void
    {
        $this->goOnline();
        $booking = $this->completedErrand(100.00, 0.00, null);
        $booking->forceFill(['status' => 'in_transit', 'completed_at' => null])->save();

        $this->goOffline()->assertStatus(422);

        $this->assertNotNull($this->profile->fresh()->online_since);
        $this->assertTrue((bool) $this->profile->fresh()->is_online);
    }
}
