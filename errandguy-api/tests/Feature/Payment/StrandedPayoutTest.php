<?php

namespace Tests\Feature\Payment;

use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The stranded payout — the money-OUT mirror of the stranded top-up, and the
 * worse of the two for the person waiting.
 *
 * A runner's wallet is debited the moment the payout row is created, and the
 * row then stays `pending` until payout.succeeded / payout.failed arrives.
 * There was no pull path, so a dropped webhook meant their money had left their
 * balance with nothing confirming it — and because the app swaps the CTA to
 * "View payout status" whenever a pending payout exists, they could not request
 * another. The only way out was to work out something was wrong and ask an
 * admin to settle it by hand.
 *
 * These pin the money behaviour: pay once, re-credit once, never invent a
 * disbursement, never touch what isn't ours, and stay correct on repeat runs.
 */
class StrandedPayoutTest extends TestCase
{
    use RefreshDatabase;

    private User $runner;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.xendit.secret_key' => 'test-secret']);
        $this->runner = User::factory()->create([
            'role' => 'runner',
            'status' => 'active',
            // Already debited by the payout below — this is the balance AFTER.
            'wallet_balance' => 200.00,
        ]);
    }

    private function strandedPayout(array $overrides = [], $createdAt = null): WalletTransaction
    {
        $tx = WalletTransaction::create(array_merge([
            'user_id' => $this->runner->id,
            'type' => 'payout',
            'status' => 'pending',
            'amount' => 500,
            'balance_after' => 200.00,
            'gateway_ref' => 'disb-stranded-1',
            'description' => 'Runner payout',
        ], $overrides));

        // created_at is not fillable on WalletTransaction — passing it through
        // create() is silently dropped and the row is stamped "now", which is
        // exactly what the age filters exclude.
        $tx->forceFill(['created_at' => $createdAt ?? now()->subHour()])->save();

        return $tx->refresh();
    }

    private function fakeGateway(string $status, array $extra = []): void
    {
        Http::preventStrayRequests();
        Http::fake([
            'api.xendit.co/v2/payouts/*' => Http::response(
                array_merge(['id' => 'disb-stranded-1', 'status' => $status], $extra),
                200,
            ),
        ]);
    }

    public function test_a_succeeded_payout_with_no_webhook_is_completed(): void
    {
        $tx = $this->strandedPayout();
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-payouts')->assertSuccessful();

        $this->assertSame('completed', $tx->fresh()->status);
        // Already debited at creation — completing must NOT debit again.
        $this->assertEquals(200.00, (float) $this->runner->fresh()->wallet_balance);
    }

    /**
     * The failure path is the one that moves money: failPayout re-credits the
     * wallet, so the runner gets their balance back instead of losing it to a
     * disbursement that never happened.
     */
    public function test_a_failed_payout_is_re_credited_to_the_runner(): void
    {
        $tx = $this->strandedPayout();
        $this->fakeGateway('FAILED', ['failure_code' => 'INVALID_DESTINATION']);

        $this->artisan('errandguy:reconcile-payouts')->assertSuccessful();

        $this->assertSame('failed', $tx->fresh()->status);
        $this->assertEquals(700.00, (float) $this->runner->fresh()->wallet_balance);
    }

    public function test_a_reversed_payout_is_also_re_credited(): void
    {
        $tx = $this->strandedPayout();
        $this->fakeGateway('REVERSED');

        $this->artisan('errandguy:reconcile-payouts')->assertSuccessful();

        $this->assertSame('failed', $tx->fresh()->status);
        $this->assertEquals(700.00, (float) $this->runner->fresh()->wallet_balance);
    }

    /**
     * The scheduler runs this every 15 minutes forever. Neither the payment nor
     * the re-credit may happen twice.
     */
    public function test_repeat_runs_settle_exactly_once(): void
    {
        $this->strandedPayout();
        $this->fakeGateway('FAILED');

        $this->artisan('errandguy:reconcile-payouts')->assertSuccessful();
        $this->artisan('errandguy:reconcile-payouts')->assertSuccessful();
        $this->artisan('errandguy:reconcile-payouts')->assertSuccessful();

        // One re-credit, not three.
        $this->assertEquals(700.00, (float) $this->runner->fresh()->wallet_balance);
    }

    /**
     * ACCEPTED / PENDING / LOCKED mean the disbursement is still in flight.
     * Touching it would either pay twice or claw back money mid-transfer.
     */
    public function test_an_in_flight_payout_is_left_alone(): void
    {
        $tx = $this->strandedPayout();
        $this->fakeGateway('ACCEPTED');

        $this->artisan('errandguy:reconcile-payouts')->assertSuccessful();

        $this->assertSame('pending', $tx->fresh()->status);
        $this->assertEquals(200.00, (float) $this->runner->fresh()->wallet_balance);
    }

    public function test_a_very_recent_payout_is_left_to_the_webhook(): void
    {
        $this->strandedPayout([], now()->subMinutes(2));
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-payouts --min-age=10')->assertSuccessful();

        Http::assertNothingSent();
    }

    public function test_a_topup_is_never_dragged_through_the_payout_path(): void
    {
        $topUp = $this->strandedPayout(['type' => 'top_up', 'gateway_ref' => 'pr_x']);
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-payouts')->assertSuccessful();

        Http::assertNothingSent();
        $this->assertSame('pending', $topUp->fresh()->status);
    }

    public function test_a_payout_with_no_gateway_reference_is_skipped(): void
    {
        $tx = $this->strandedPayout(['gateway_ref' => null]);
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-payouts')->assertSuccessful();

        Http::assertNothingSent();
        $this->assertSame('pending', $tx->fresh()->status);
    }

    public function test_dry_run_settles_nothing(): void
    {
        $tx = $this->strandedPayout();
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-payouts --dry-run')->assertSuccessful();

        Http::assertNothingSent();
        $this->assertSame('pending', $tx->fresh()->status);
    }

    public function test_a_late_settlement_raises_an_admin_alert(): void
    {
        $tx = $this->strandedPayout();
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-payouts')->assertSuccessful();

        $this->assertDatabaseHas('admin_alerts', [
            'type' => 'payout_reconciled',
            'subject_id' => $tx->id,
        ]);
    }

    /**
     * The runner's payout screen loads GET /wallet/transactions?type=payout, so
     * opening it is the strongest signal someone is waiting on that money. It
     * must heal the row AND return the healed state — otherwise they are shown
     * 'pending' anyway and have to refresh to see money that already landed.
     * This also works when the scheduler is down.
     */
    public function test_the_runners_own_payout_screen_heals_a_stranded_row(): void
    {
        $tx = $this->strandedPayout();
        $this->fakeGateway('SUCCEEDED');

        $response = $this->actingAs($this->runner)
            ->getJson('/api/v1/wallet/transactions?type=payout')
            ->assertOk();

        $this->assertSame('completed', $tx->fresh()->status);
        $this->assertSame(
            'completed',
            collect($response->json('data'))->firstWhere('id', $tx->id)['status'] ?? null,
            'the response must reflect the state it just wrote',
        );
    }

    /**
     * Each reconcile is a blocking gateway GET, so a page full of pending
     * payouts must not turn one list read into twenty round trips.
     */
    public function test_the_read_path_bounds_how_many_it_reconciles(): void
    {
        for ($i = 0; $i < 6; $i++) {
            $this->strandedPayout(['gateway_ref' => "disb-many-{$i}"], now()->subHours($i + 1));
        }
        Http::preventStrayRequests();
        Http::fake(['api.xendit.co/v2/payouts/*' => Http::response(['status' => 'ACCEPTED'], 200)]);

        $this->actingAs($this->runner)
            ->getJson('/api/v1/wallet/transactions?type=payout')
            ->assertOk();

        $sent = 0;
        Http::recorded(function () use (&$sent) {
            $sent++;

            return true;
        });
        $this->assertLessThanOrEqual(3, $sent, 'a user-facing read must bound its gateway calls');
    }
}
