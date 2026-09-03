<?php

namespace Tests\Feature\Payment;

use App\Models\AdminAlert;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The stranded top-up.
 *
 * The status endpoint pull-reconciles a pending top-up against the gateway —
 * but ONLY while the app is polling it. That left one case uncovered entirely:
 * the customer pays in GCash, the webhook is delayed or dropped, and they never
 * reopen the app (force-quit from the GCash return, a crash, or they simply put
 * the phone down). Their money has left their e-wallet, the row stays `pending`
 * forever, and nothing on either side is reconciling it. The only option they
 * can see is to top up a second time.
 *
 * The sweep is the safety net, sharing ONE settlement path with the polling
 * endpoint (WalletService::reconcilePendingTopUp) so the two cannot drift.
 *
 * What these lock down is money behaviour: credit exactly once, never invent a
 * payment, never touch what isn't ours, and stay correct when run repeatedly
 * (the scheduler runs it every 15 minutes, forever).
 */
class StrandedTopUpSweepTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.xendit.secret_key' => 'test-secret']);
        $this->user = User::factory()->create([
            'role' => 'customer',
            'status' => 'active',
            'wallet_balance' => 100.00,
        ]);
    }

    /**
     * @param  array<string,mixed>  $overrides
     * @param  \Illuminate\Support\Carbon|null  $createdAt  defaults to 30 minutes
     *   ago — past --min-age, so the webhook has already had its chance.
     */
    private function strandedTopUp(array $overrides = [], $createdAt = null): WalletTransaction
    {
        $tx = WalletTransaction::create(array_merge([
            'user_id' => $this->user->id,
            'type' => 'top_up',
            'status' => 'pending',
            'amount' => 500,
            'balance_after' => 100.00,
            'gateway_ref' => 'pr_stranded',
            'description' => 'Wallet top-up',
        ], $overrides));

        // `created_at` is not fillable on WalletTransaction, so it cannot be
        // passed through create() — it would be silently dropped and the row
        // would be stamped "now", which is exactly what the age filters exclude.
        $tx->forceFill(['created_at' => $createdAt ?? now()->subMinutes(30)])->save();

        return $tx->refresh();
    }

    private function fakeGateway(string $status): void
    {
        Http::preventStrayRequests();
        Http::fake([
            'api.xendit.co/payment_requests/*' => Http::response(
                ['id' => 'pr_stranded', 'status' => $status, 'amount' => 500],
                200,
            ),
        ]);
    }

    public function test_a_paid_but_unwebhooked_topup_is_credited(): void
    {
        $tx = $this->strandedTopUp();
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-topups')->assertSuccessful();

        $this->assertSame('completed', $tx->fresh()->status);
        $this->assertEquals(600.00, (float) $this->user->fresh()->wallet_balance);
    }

    /**
     * The scheduler runs this every 15 minutes forever. A second pass over an
     * already-settled top-up must not credit again.
     */
    public function test_running_the_sweep_repeatedly_credits_only_once(): void
    {
        $this->strandedTopUp();
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-topups')->assertSuccessful();
        $this->artisan('errandguy:reconcile-topups')->assertSuccessful();
        $this->artisan('errandguy:reconcile-topups')->assertSuccessful();

        $this->assertEquals(600.00, (float) $this->user->fresh()->wallet_balance);
        $this->assertSame(1, WalletTransaction::where('status', 'completed')->count());
    }

    /**
     * A late credit means a webhook never arrived — a user-facing fix AND an
     * ops signal. One is a blip; a pattern is a delivery problem.
     */
    public function test_a_late_credit_raises_an_admin_alert(): void
    {
        $tx = $this->strandedTopUp();
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-topups')->assertSuccessful();

        $this->assertDatabaseHas('admin_alerts', [
            'type' => 'topup_reconciled',
            'subject_id' => $tx->id,
        ]);
        $this->assertSame('warning', AdminAlert::where('subject_id', $tx->id)->value('severity'));
    }

    public function test_a_gateway_failure_closes_the_row_without_crediting(): void
    {
        $tx = $this->strandedTopUp();
        $this->fakeGateway('FAILED');

        $this->artisan('errandguy:reconcile-topups')->assertSuccessful();

        $this->assertSame('failed', $tx->fresh()->status);
        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);
        $this->assertDatabaseMissing('admin_alerts', ['type' => 'topup_reconciled']);
    }

    /**
     * The customer opened checkout and never paid. Nothing to settle — and
     * emphatically nothing to credit.
     */
    public function test_a_still_pending_gateway_status_leaves_the_row_alone(): void
    {
        $tx = $this->strandedTopUp();
        $this->fakeGateway('PENDING');

        $this->artisan('errandguy:reconcile-topups')->assertSuccessful();

        $this->assertSame('pending', $tx->fresh()->status);
        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);
    }

    /**
     * A top-up seconds old is the webhook's job. Sweeping it immediately would
     * race the primary settlement path for no benefit.
     */
    public function test_a_very_recent_topup_is_left_to_the_webhook(): void
    {
        $this->strandedTopUp([], now()->subMinute());
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-topups --min-age=5')->assertSuccessful();

        Http::assertNothingSent();
        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);
    }

    /**
     * A hosted card invoice's gateway_ref is a hex ObjectId, not a "pr…"
     * Payment Request id, and PaymentService exposes no invoice read. Those
     * stay webhook-only — the sweep must not mis-address a lookup.
     */
    public function test_a_hosted_invoice_topup_is_not_pulled(): void
    {
        $this->strandedTopUp(['gateway_ref' => '65f1c0ffee1234567890abcd']);
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-topups')->assertSuccessful();

        Http::assertNothingSent();
        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);
    }

    /**
     * Only top-ups. A pending payout or refund row must never be dragged
     * through a top-up settlement path.
     */
    public function test_non_topup_transactions_are_never_touched(): void
    {
        $payout = WalletTransaction::create([
            'user_id' => $this->user->id,
            'type' => 'payout',
            'status' => 'pending',
            'amount' => 300,
            'balance_after' => 100.00,
            'gateway_ref' => 'pr_payout',
            'description' => 'Payout',
        ]);
        $payout->forceFill(['created_at' => now()->subHours(2)])->save();
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-topups')->assertSuccessful();

        Http::assertNothingSent();
        $this->assertSame('pending', $payout->fresh()->status);
        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);
    }

    /**
     * Beyond the gateway's own payment window the truth is no longer
     * retrievable, and sweeping ancient rows forever is unbounded work.
     */
    public function test_a_topup_older_than_the_window_is_ignored(): void
    {
        $this->strandedTopUp([], now()->subDays(30));
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-topups --max-age=7')->assertSuccessful();

        Http::assertNothingSent();
        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);
    }

    public function test_dry_run_settles_nothing(): void
    {
        $tx = $this->strandedTopUp();
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-topups --dry-run')->assertSuccessful();

        Http::assertNothingSent();
        $this->assertSame('pending', $tx->fresh()->status);
        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);
    }

    /**
     * The sweep runs exactly where nobody is polling, so the polling endpoint's
     * 10s per-transaction latch must not be able to silence it. (A throttle
     * window of 0 bypasses the latch by an explicit branch — passing 0 to
     * Cache::add returns false for any non-positive TTL and would have made
     * the sweep pull nothing at all.)
     */
    public function test_the_polling_throttle_cannot_silence_the_sweep(): void
    {
        $tx = $this->strandedTopUp();
        $this->fakeGateway('SUCCEEDED');

        // Simulate the app having just polled this very transaction.
        \Illuminate\Support\Facades\Cache::put("topup_reconcile_pull:{$tx->id}", 1, 60);

        $this->artisan('errandguy:reconcile-topups')->assertSuccessful();

        $this->assertSame('completed', $tx->fresh()->status);
        $this->assertEquals(600.00, (float) $this->user->fresh()->wallet_balance);
    }
}
