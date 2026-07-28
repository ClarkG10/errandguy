<?php

namespace Tests\Feature\Referral;

use App\Events\BookingStatusChanged;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Referral;
use App\Models\User;
use App\Services\ReferralService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReferralTest extends TestCase
{
    use RefreshDatabase;

    private function makeErrandType(): ErrandType
    {
        return ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeCompletedBooking(User $customer, User $runner, ErrandType $type, string $number, string $method = 'gcash'): Booking
    {
        $booking = Booking::create([
            'booking_number' => $number,
            'customer_id' => $customer->id, 'runner_id' => $runner->id,
            'errand_type_id' => $type->id, 'status' => 'completed',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false, 'completed_at' => now(),
            'payment_status' => $method === 'cash' ? 'unpaid' : 'paid',
        ]);

        // A referral only qualifies on a genuinely settled, non-cash errand
        // (P0-6). Cash payments sit 'pending' and never qualify.
        \App\Models\Payment::create([
            'booking_id' => $booking->id, 'customer_id' => $customer->id,
            'amount' => 115.00, 'currency' => 'PHP', 'method' => $method,
            'status' => $method === 'cash' ? 'pending' : 'completed',
            'paid_at' => $method === 'cash' ? null : now(),
        ]);

        return $booking;
    }

    public function test_referral_code_generated_on_user_creation(): void
    {
        $user = User::factory()->create();

        $this->assertNotNull($user->referral_code);
        $this->assertSame(8, strlen($user->referral_code));
    }

    public function test_referral_codes_are_unique_across_users(): void
    {
        $a = User::factory()->create();
        $b = User::factory()->create();

        $this->assertNotSame($a->referral_code, $b->referral_code);
    }

    public function test_customer_can_view_their_referral_info(): void
    {
        $user = User::factory()->create(['role' => 'customer']);

        $this->actingAs($user)
            ->getJson('/api/v1/user/referral')
            ->assertOk()
            ->assertJsonPath('data.referral_code', $user->referral_code)
            ->assertJsonPath('data.counts.pending', 0)
            ->assertJsonPath('data.total_earned', 0);
    }

    public function test_apply_referral_happy_path(): void
    {
        $referrer = User::factory()->create();
        $referee = User::factory()->create();

        $this->actingAs($referee)
            ->postJson('/api/v1/user/referral/apply', ['code' => $referrer->referral_code])
            ->assertCreated()
            ->assertJsonPath('data.status', 'pending');

        $this->assertDatabaseHas('referrals', [
            'referrer_id' => $referrer->id,
            'referee_id' => $referee->id,
            'status' => 'pending',
        ]);
        $this->assertSame($referrer->id, $referee->fresh()->referred_by);
    }

    public function test_apply_rejects_self_referral(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->postJson('/api/v1/user/referral/apply', ['code' => $user->referral_code])
            ->assertStatus(422);

        $this->assertDatabaseCount('referrals', 0);
    }

    public function test_apply_rejects_invalid_code(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->postJson('/api/v1/user/referral/apply', ['code' => 'NOTACODE'])
            ->assertStatus(422);
    }

    public function test_apply_rejects_duplicate_referral(): void
    {
        $referrerA = User::factory()->create();
        $referrerB = User::factory()->create();
        $referee = User::factory()->create();

        $this->actingAs($referee)
            ->postJson('/api/v1/user/referral/apply', ['code' => $referrerA->referral_code])
            ->assertCreated();

        // Second attempt (even with a different code) must be rejected.
        $this->actingAs($referee)
            ->postJson('/api/v1/user/referral/apply', ['code' => $referrerB->referral_code])
            ->assertStatus(422);

        $this->assertDatabaseCount('referrals', 1);
    }

    public function test_reward_credited_to_both_on_first_completion(): void
    {
        $type = $this->makeErrandType();
        $referrer = User::factory()->create(['wallet_balance' => 0]);
        $referee = User::factory()->create(['wallet_balance' => 0]);
        $runner = User::factory()->runner()->create();

        app(ReferralService::class)->attach($referee->id, $referrer->referral_code);

        $booking = $this->makeCompletedBooking($referee, $runner, $type, 'EG-REF-0001');

        event(new BookingStatusChanged($booking, 'delivered', 'completed'));

        // Bonuses are NON-WITHDRAWABLE (P0-6): they land in bonus_balance, not
        // the cashable wallet_balance.
        $this->assertEquals(0.0, (float) $referrer->fresh()->wallet_balance);
        $this->assertEquals(0.0, (float) $referee->fresh()->wallet_balance);
        $this->assertEquals(50.0, (float) $referrer->fresh()->bonus_balance);
        $this->assertEquals(50.0, (float) $referee->fresh()->bonus_balance);
        $this->assertDatabaseHas('referrals', [
            'referee_id' => $referee->id,
            'status' => 'rewarded',
        ]);
        $this->assertNotNull(Referral::where('referee_id', $referee->id)->first()->rewarded_at);
    }

    public function test_reward_is_idempotent(): void
    {
        $type = $this->makeErrandType();
        $referrer = User::factory()->create(['wallet_balance' => 0]);
        $referee = User::factory()->create(['wallet_balance' => 0]);
        $runner = User::factory()->runner()->create();

        app(ReferralService::class)->attach($referee->id, $referrer->referral_code);
        // A qualifying (settled, non-cash) booking so the reward is eligible.
        $this->makeCompletedBooking($referee, $runner, $type, 'EG-REF-IDEM', 'gcash');

        // Reward twice directly — the second call must be a no-op.
        app(ReferralService::class)->reward($referee->id);
        app(ReferralService::class)->reward($referee->id);

        $this->assertEquals(50.0, (float) $referrer->fresh()->bonus_balance);
        $this->assertEquals(50.0, (float) $referee->fresh()->bonus_balance);
        $this->assertSame(1, \App\Models\WalletTransaction::where('user_id', $referrer->id)
            ->where('type', 'bonus')->count());
    }

    public function test_cash_only_errand_does_not_qualify_a_reward(): void
    {
        // The core farming vector: a fake "cash" errand moves no money through
        // the platform, so it must NOT mint a referral bonus.
        $type = $this->makeErrandType();
        $referrer = User::factory()->create(['bonus_balance' => 0]);
        $referee = User::factory()->create(['bonus_balance' => 0]);
        $runner = User::factory()->runner()->create();

        app(ReferralService::class)->attach($referee->id, $referrer->referral_code);
        $booking = $this->makeCompletedBooking($referee, $runner, $type, 'EG-REF-CASH', 'cash');

        event(new BookingStatusChanged($booking, 'delivered', 'completed'));

        $this->assertEquals(0.0, (float) $referrer->fresh()->bonus_balance);
        $this->assertEquals(0.0, (float) $referee->fresh()->bonus_balance);
        // Referral stays pending so a later genuine paid booking can still reward.
        $this->assertDatabaseHas('referrals', [
            'referee_id' => $referee->id,
            'status' => 'pending',
        ]);
    }

    public function test_reward_waits_for_settlement_when_payment_lags_completion(): void
    {
        // Online payment can settle AFTER the errand is completed (webhook lag).
        // The reward must not be lost: it no-ops while the Payment is pending and
        // fires once the Payment actually completes (the webhook re-triggers it).
        $type = $this->makeErrandType();
        $referrer = User::factory()->create(['bonus_balance' => 0]);
        $referee = User::factory()->create(['bonus_balance' => 0]);
        $runner = User::factory()->runner()->create();

        app(ReferralService::class)->attach($referee->id, $referrer->referral_code);

        // Completed booking, but its GCash Payment is still PENDING.
        $booking = Booking::create([
            'booking_number' => 'EG-REF-LAG1',
            'customer_id' => $referee->id, 'runner_id' => $runner->id,
            'errand_type_id' => $type->id, 'status' => 'completed',
            'pickup_address' => '1 A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.9,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.5, 'dropoff_lng' => 121.0,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false, 'completed_at' => now(), 'payment_status' => 'pending',
        ]);
        $payment = \App\Models\Payment::create([
            'booking_id' => $booking->id, 'customer_id' => $referee->id,
            'amount' => 115, 'currency' => 'PHP', 'method' => 'gcash', 'status' => 'pending',
        ]);

        // The completion listener runs while the payment is unsettled → no reward.
        app(ReferralService::class)->reward($referee->id);
        $this->assertEquals(0.0, (float) $referrer->fresh()->bonus_balance);
        $this->assertDatabaseHas('referrals', ['referee_id' => $referee->id, 'status' => 'pending']);

        // Settlement lands → reward fires (mirrors the webhook re-trigger).
        $payment->update(['status' => 'completed', 'paid_at' => now()]);
        app(ReferralService::class)->reward($referee->id);

        $this->assertEquals(50.0, (float) $referrer->fresh()->bonus_balance);
        $this->assertEquals(50.0, (float) $referee->fresh()->bonus_balance);
        $this->assertDatabaseHas('referrals', ['referee_id' => $referee->id, 'status' => 'rewarded']);
    }

    public function test_referrer_stops_earning_past_the_cap(): void
    {
        \App\Models\SystemConfig::query()->updateOrCreate(
            ['key' => 'referral_max_rewards_per_referrer'],
            ['value' => '1'],
        );

        $type = $this->makeErrandType();
        $referrer = User::factory()->create(['bonus_balance' => 0]);
        $runner = User::factory()->runner()->create();

        // First referee: referrer earns.
        $a = User::factory()->create(['bonus_balance' => 0]);
        app(ReferralService::class)->attach($a->id, $referrer->referral_code);
        $this->makeCompletedBooking($a, $runner, $type, 'EG-REF-CAP1', 'gcash');
        app(ReferralService::class)->reward($a->id);

        // Second referee: cap hit — referrer does NOT earn again, but the
        // referee still gets their welcome bonus.
        $b = User::factory()->create(['bonus_balance' => 0]);
        app(ReferralService::class)->attach($b->id, $referrer->referral_code);
        $this->makeCompletedBooking($b, $runner, $type, 'EG-REF-CAP2', 'gcash');
        app(ReferralService::class)->reward($b->id);

        $this->assertEquals(50.0, (float) $referrer->fresh()->bonus_balance, 'referrer capped at one reward');
        $this->assertEquals(50.0, (float) $a->fresh()->bonus_balance);
        $this->assertEquals(50.0, (float) $b->fresh()->bonus_balance);
    }

    public function test_reward_not_triggered_without_referral(): void
    {
        $type = $this->makeErrandType();
        $customer = User::factory()->create(['wallet_balance' => 0]);
        $runner = User::factory()->runner()->create();

        $booking = $this->makeCompletedBooking($customer, $runner, $type, 'EG-REF-0002');
        event(new BookingStatusChanged($booking, 'delivered', 'completed'));

        $this->assertEquals(0.0, (float) $customer->fresh()->wallet_balance);
    }

    public function test_reward_still_credited_when_a_second_booking_completed_before_the_job_runs(): void
    {
        // The listener is queued (ShouldQueue). If the referee completes a
        // second booking before the first completion's job is processed, the
        // DB already shows 2 completed bookings when the job finally runs. A
        // strict "exactly 1 completed" gate would silently drop the reward
        // forever; it must still be credited — exactly once (reward() is
        // idempotent). Regression guard for the strict `!== 1` bug.
        $type = $this->makeErrandType();
        $referrer = User::factory()->create(['wallet_balance' => 0]);
        $referee = User::factory()->create(['wallet_balance' => 0]);
        $runner = User::factory()->runner()->create();

        app(ReferralService::class)->attach($referee->id, $referrer->referral_code);

        // Two bookings already completed by the time the delayed job fires.
        $first = $this->makeCompletedBooking($referee, $runner, $type, 'EG-REF-0003');
        $this->makeCompletedBooking($referee, $runner, $type, 'EG-REF-0004');

        event(new BookingStatusChanged($first, 'delivered', 'completed'));

        $this->assertEquals(50.0, (float) $referrer->fresh()->bonus_balance);
        $this->assertEquals(50.0, (float) $referee->fresh()->bonus_balance);
        $this->assertDatabaseHas('referrals', [
            'referee_id' => $referee->id,
            'status' => 'rewarded',
        ]);
        $this->assertSame(1, \App\Models\WalletTransaction::where('user_id', $referrer->id)
            ->where('type', 'bonus')->count());
    }
}
