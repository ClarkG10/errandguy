<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\SystemConfig;
use App\Models\User;
use App\Services\MatchingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * The cash-debt ceiling (`runner_cash_debt_limit`).
 *
 * A CASH errand settles by DEBITING the runner's wallet for the platform's
 * commission (RunnerErrandController::handleCompletion) — the runner has already
 * pocketed the whole fare in person. Nothing kept that balance non-negative and
 * nothing stopped an indebted runner taking more cash work, so a runner could
 * collect cash indefinitely, drive the balance arbitrarily negative and walk
 * away. In a cash-dominant market that is unbounded, uncollectable bad debt.
 *
 * Three gates share ONE policy (App\Support\CashDebtPolicy) so they can never
 * disagree — a dispatcher that offers what accept() refuses is just a dead end:
 *   1. accept()            — authoritative, under the runner's row lock;
 *   2. MatchingService     — don't dispatch cash work that will be refused;
 *   3. available()         — don't show it in the pull feed either.
 *
 * The block is deliberately CASH-only: prepaid and wallet errands CREDIT the
 * runner, so the way back above the line is always open.
 */
class CashDebtCeilingTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        RunnerProfile::create([
            'user_id' => $this->runner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'current_lat' => 14.5995,
            'current_lng' => 120.9842,
            'preferred_types' => [],
            'acceptance_rate' => 100.00,
            'completion_rate' => 100.00,
            'total_errands' => 0,
            'total_earnings' => 0.00,
        ]);

        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function booking(string $paymentMethod, string $suffix, array $extra = []): Booking
    {
        return Booking::create(array_merge([
            'booking_number' => 'EG-20260906-'.$suffix,
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->errandType->id,
            'status' => 'pending',
            'payment_method' => $paymentMethod,
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ], $extra));
    }

    /** Push the runner past the configured ceiling. */
    private function indebt(float $balance = -1500.00): void
    {
        $this->runner->update(['wallet_balance' => $balance]);
    }

    public function test_indebted_runner_cannot_accept_a_cash_errand(): void
    {
        Event::fake();
        $this->indebt();
        $booking = $this->booking('cash', 'CASH');

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$booking->id}/accept");

        $response->assertStatus(409);
        $this->assertNull($booking->fresh()->runner_id);
    }

    public function test_the_refusal_names_the_amount_to_settle(): void
    {
        Event::fake();
        $this->indebt();
        $booking = $this->booking('cash', 'MSG');

        $body = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$booking->id}/accept")
            ->json('message');

        // A bare refusal leaves the runner blocked with no next step.
        $this->assertStringContainsString('1,500.00', (string) $body);
        $this->assertStringContainsString('500.01', (string) $body, 'must state what to settle to get back to work');
    }

    public function test_indebted_runner_can_still_accept_a_PREPAID_errand(): void
    {
        Event::fake();
        $this->indebt();
        // Prepaid work CREDITS the runner — it is how they climb out of debt, so
        // blocking it would trap them with no route back.
        $booking = $this->booking('gcash', 'PAID', ['payment_status' => 'paid']);

        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$booking->id}/accept")
            ->assertOk();

        $this->assertSame($this->runner->id, $booking->fresh()->runner_id);
    }

    public function test_a_runner_just_under_the_ceiling_is_unaffected(): void
    {
        Event::fake();
        $this->indebt(-999.99); // limit is 1000
        $booking = $this->booking('cash', 'EDGE');

        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$booking->id}/accept")
            ->assertOk();
    }

    public function test_setting_the_limit_to_zero_disables_the_block(): void
    {
        Event::fake();
        SystemConfig::setValue('runner_cash_debt_limit', '0');
        $this->indebt(-99999.00);
        $booking = $this->booking('cash', 'OFF');

        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$booking->id}/accept")
            ->assertOk();
    }

    public function test_matching_does_not_dispatch_cash_work_to_an_indebted_runner(): void
    {
        $this->indebt();
        $cash = $this->booking('cash', 'DISP');

        $this->assertNull(
            app(MatchingService::class)->findRunner($cash->id),
            'an offer that accept() is certain to refuse must never be dispatched',
        );

        // Same runner, same radius — only the payment method differs.
        $prepaid = $this->booking('gcash', 'DIS2');
        $this->assertNotNull(app(MatchingService::class)->findRunner($prepaid->id));
    }

    public function test_the_pull_feed_hides_cash_offers_but_says_why_on_home(): void
    {
        $this->indebt();

        $cashOffer = $this->booking('cash', 'FEED', [
            'pricing_mode' => 'negotiate',
            'negotiate_expires_at' => now()->addMinutes(5),
            'customer_offer' => 120,
        ]);
        $prepaidOffer = $this->booking('gcash', 'FEE2', [
            'pricing_mode' => 'negotiate',
            'negotiate_expires_at' => now()->addMinutes(5),
            'customer_offer' => 120,
        ]);

        $ids = collect(
            $this->actingAs($this->runner)->getJson('/api/v1/runner/errand/available')->json('data')
        )->pluck('id')->all();

        $this->assertNotContains($cashOffer->id, $ids);
        $this->assertContains($prepaidOffer->id, $ids);

        // A silently shorter feed is its own bug — the runner has to be told
        // the jobs are missing because of the debt, not because work dried up.
        $block = $this->actingAs($this->runner)->getJson('/api/v1/runner/home')->json('data.profile.cash_debt_block');
        $this->assertNotNull($block);
        $this->assertSame(1500.0, (float) $block['owed']);
        $this->assertSame(1000.0, (float) $block['limit']);
    }

    /**
     * The block rides RunnerProfileResource, so EVERY surface that serializes a
     * runner's own profile must carry it — not just the /runner/home aggregate.
     * It reads the balance off the authenticated user rather than the `user`
     * relation, so no caller has to remember to eager-load anything: `show()`
     * did, `update()` and the nested UserResource on /me did not.
     */
    public function test_every_self_profile_surface_carries_the_block(): void
    {
        $this->indebt();

        foreach ([
            ['GET', '/api/v1/runner/profile', [], 'data.cash_debt_block'],
            ['GET', '/api/v1/runner/home', [], 'data.profile.cash_debt_block'],
        ] as [$method, $uri, $payload, $path]) {
            $block = $this->actingAs($this->runner)->json($method, $uri, $payload)->json($path);
            $this->assertNotNull($block, "{$uri} must carry the cash-debt block");
            $this->assertSame(1500.0, (float) $block['owed'], "{$uri} reported the wrong debt");
        }
    }

    /** A profile UPDATE response is a self surface too — it was the asymmetric one. */
    public function test_the_update_response_carries_the_block_too(): void
    {
        $this->indebt();

        $block = $this->actingAs($this->runner)
            ->putJson('/api/v1/runner/profile', ['vehicle_type' => 'motorcycle'])
            ->json('data.cash_debt_block');

        $this->assertNotNull($block);
        $this->assertSame(1500.0, (float) $block['owed']);
    }

    /**
     * A runner's debt is private financial data. RunnerProfileResource is
     * serialized INSIDE customer-facing payloads (BookingResource → runner →
     * runner_profile), so the $isSelf guard is what keeps it out — not route
     * authorization. Asserted against the resource directly with the CUSTOMER as
     * the request user: hitting /runner/profile as a customer would only prove
     * the `role:runner` middleware works, and would pass even if the guard were
     * removed. Uses resolve(), not toArray(): toArray() leaves when()'s
     * MissingValue sentinel in the array, so the key is present either way and
     * the assertion would be meaningless.
     */
    public function test_the_block_is_never_exposed_to_anyone_else(): void
    {
        $this->indebt();

        $request = \Illuminate\Http\Request::create('/api/v1/runner/profile');
        $request->setUserResolver(fn () => $this->customer);

        $payload = (new \App\Http\Resources\RunnerProfileResource(
            $this->runner->fresh()->runnerProfile,
        ))->resolve($request);

        $this->assertArrayNotHasKey(
            'cash_debt_block',
            $payload,
            "a runner's debt must never be serialized to anyone but the runner",
        );

        // Control: the same resource DOES carry it for the runner themselves, so
        // the assertion above cannot pass just because the key stopped existing.
        $own = \Illuminate\Http\Request::create('/api/v1/runner/profile');
        $own->setUserResolver(fn () => $this->runner);
        $this->assertNotNull(
            (new \App\Http\Resources\RunnerProfileResource(
                $this->runner->fresh()->runnerProfile,
            ))->resolve($own)['cash_debt_block'],
        );
    }

    public function test_a_solvent_runner_sees_no_block_on_home(): void
    {
        $this->runner->update(['wallet_balance' => 250.00]);

        $this->assertNull(
            $this->actingAs($this->runner)->getJson('/api/v1/runner/home')->json('data.profile.cash_debt_block'),
        );
    }
}
