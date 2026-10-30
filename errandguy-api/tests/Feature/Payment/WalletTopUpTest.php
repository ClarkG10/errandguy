<?php

namespace Tests\Feature\Payment;

use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Wallet top-ups are retired: the wallet only spends a balance the customer
 * already has. The endpoint answers the app build already on phones with a
 * clear 422, and a top-up started BEFORE the retirement still settles — by
 * webhook, by the status probe's pull and by the sweep — so no customer money
 * paid in around the deploy is stranded.
 */
class WalletTopUpTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.xendit.secret_key' => 'test-secret']);
        config(['services.xendit.webhook_token' => 'test-webhook-token']);
        $this->user = User::factory()->create([
            'role' => 'customer',
            'status' => 'active',
            'wallet_balance' => 100.00,
            'email' => 'buyer@example.com',
        ]);
    }

    /** A top-up started before top-ups were retired, still awaiting payment. */
    private function legacyTopUp(string $gatewayRef, float $amount = 500): WalletTransaction
    {
        return WalletTransaction::create([
            'user_id' => $this->user->id, 'type' => 'top_up', 'amount' => $amount,
            'balance_after' => 100, 'status' => 'pending', 'gateway_ref' => $gatewayRef,
            'checkout_url' => "https://checkout.example/{$gatewayRef}",
            'description' => 'Wallet top-up (awaiting payment)',
        ]);
    }

    public function test_the_top_up_endpoint_is_retired_with_a_clear_message(): void
    {
        Http::fake();

        $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 500, 'method' => 'gcash'])
            ->assertStatus(422)
            ->assertJsonPath('code', 'FEATURE_RETIRED')
            ->assertJsonPath('message', 'Wallet top-ups are no longer available. You can still pay with GCash, Maya or cash, and spend any balance you already have.');

        $this->assertSame(0, WalletTransaction::count());
        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);
        Http::assertNothingSent();
    }

    public function test_payment_succeeded_webhook_credits_a_direct_ewallet_topup(): void
    {
        $tx = $this->legacyTopUp('pr_tu2');

        // Xendit confirms via payment.succeeded (matched on gateway_ref).
        $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'payment.succeeded',
            'data' => ['payment_request_id' => 'pr_tu2', 'amount' => 500],
        ], ['x-callback-token' => 'test-webhook-token'])->assertOk();

        $this->assertEquals(600.00, (float) $this->user->fresh()->wallet_balance);
        $this->assertEquals('completed', $tx->fresh()->status);
    }

    public function test_payment_failed_webhook_marks_a_direct_ewallet_topup_failed_without_crediting(): void
    {
        $tx = $this->legacyTopUp('pr_tu3');

        $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'payment.failed',
            'data' => ['payment_request_id' => 'pr_tu3'],
        ], ['x-callback-token' => 'test-webhook-token'])->assertOk();

        $this->assertEquals('failed', $tx->fresh()->status);
        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);
    }

    public function test_invoice_paid_webhook_credits_wallet(): void
    {
        $tx = $this->legacyTopUp('inv_abc');

        $webhook = $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'invoice.paid',
            'data' => ['external_id' => "topup-{$tx->id}", 'id' => 'inv_abc', 'status' => 'PAID'],
        ], ['x-callback-token' => 'test-webhook-token']);

        $webhook->assertOk();

        $this->assertEquals(600.00, (float) $this->user->fresh()->wallet_balance);
        $this->assertEquals('completed', $tx->fresh()->status);
        $this->assertEquals(600.00, (float) $tx->fresh()->balance_after);
    }

    public function test_flat_invoice_webhook_credits_wallet(): void
    {
        // Real Xendit INVOICE callbacks POST the invoice object FLAT — no
        // {event, data} wrapper, just top-level fields incl. status: "PAID".
        $tx = $this->legacyTopUp('inv_flat');

        $webhook = $this->postJson('/api/v1/webhooks/xendit', [
            'id' => 'inv_flat',
            'external_id' => "topup-{$tx->id}",
            'status' => 'PAID',
            'amount' => 500,
        ], ['x-callback-token' => 'test-webhook-token']);

        $webhook->assertOk();
        $this->assertEquals(600.00, (float) $this->user->fresh()->wallet_balance);
        $this->assertEquals('completed', $tx->fresh()->status);
    }

    public function test_unrelated_flat_invoice_is_acknowledged_not_rejected(): void
    {
        // Xendit's dashboard "Test" button sends a sample invoice whose
        // external_id doesn't match any of our txns. We must ACK it (200),
        // not 400 "Invalid payload".
        $this->postJson('/api/v1/webhooks/xendit', [
            'id' => '579c8d61f23fa4ca35e52da4',
            'external_id' => 'invoice_123124123',
            'status' => 'PAID',
            'amount' => 50000,
        ], ['x-callback-token' => 'test-webhook-token'])->assertOk();
    }

    public function test_invoice_paid_webhook_is_idempotent(): void
    {
        $tx = $this->legacyTopUp('inv_xyz', 300);

        $payload = [
            'event' => 'invoice.paid',
            'data' => ['external_id' => "topup-{$tx->id}", 'id' => 'inv_xyz'],
        ];
        $headers = ['x-callback-token' => 'test-webhook-token'];

        $this->postJson('/api/v1/webhooks/xendit', $payload, $headers)->assertOk();
        $this->postJson('/api/v1/webhooks/xendit', $payload, $headers)->assertOk();

        // Credited exactly once despite two deliveries.
        $this->assertEquals(400.00, (float) $this->user->fresh()->wallet_balance);
    }

    public function test_webhook_rejects_invalid_token(): void
    {
        $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'invoice.paid',
            'data' => ['external_id' => 'topup-nonexistent'],
        ], ['x-callback-token' => 'wrong-token'])->assertStatus(400);
    }

    public function test_payment_return_bridge_forwards_to_app_deep_link(): void
    {
        // Xendit redirects here after payment; the page must forward to the
        // app deep link so the in-app checkout sheet auto-closes.
        $this->get('/payment/complete')
            ->assertOk()
            ->assertSee('errandguy://payment-complete');
    }

    // ── Pull-reconcile on the top-up status probe ───────────────────────────
    // Top-up used to be the ONLY money-in flow with no pull path: the booking
    // probe asks Xendit when a webhook lags, but this endpoint just re-read the
    // DB row — so a delayed/dropped webhook stranded a customer whose money had
    // already left GCash on "Payment is being processed" indefinitely.

    /** A pending legacy e-wallet top-up (its ref is a Payment Requests id). */
    private function pendingEwalletTopUp(string $prId, float $amount = 500): WalletTransaction
    {
        return $this->legacyTopUp($prId, $amount);
    }

    public function test_status_probe_pulls_the_gateway_and_credits_a_topup_the_webhook_never_delivered(): void
    {
        $tx = $this->pendingEwalletTopUp('pr-tu-reconcile-1');

        // No webhook ever arrives; Xendit says the charge SUCCEEDED.
        Http::fake([
            'api.xendit.co/payment_requests/pr-tu-reconcile-1' => Http::response([
                'id' => 'pr-tu-reconcile-1', 'status' => 'SUCCEEDED', 'amount' => 500,
            ], 200),
        ]);

        $this->actingAs($this->user)
            ->getJson("/api/v1/wallet/transactions/{$tx->id}/status")
            ->assertOk()
            // The poll itself now lands the terminal state the client waits for.
            ->assertJsonPath('data.status', 'completed');

        // Settled through completeTopUp — real credit, ledger balance stamped.
        $this->assertEquals('completed', $tx->fresh()->status);
        $this->assertEquals(600.00, (float) $this->user->fresh()->wallet_balance);
    }

    public function test_status_probe_reconcile_credits_exactly_once_across_repeat_polls(): void
    {
        $tx = $this->pendingEwalletTopUp('pr-tu-reconcile-2');

        Http::fake([
            'api.xendit.co/payment_requests/pr-tu-reconcile-2' => Http::response([
                'id' => 'pr-tu-reconcile-2', 'status' => 'SUCCEEDED', 'amount' => 500,
            ], 200),
        ]);

        // The app polls every ~3s; the throttle plus completeTopUp's own
        // row-locked pending-check must make repeat polls (and a racing
        // webhook) a no-op after the first credit.
        for ($i = 0; $i < 3; $i++) {
            $this->actingAs($this->user)
                ->getJson("/api/v1/wallet/transactions/{$tx->id}/status")
                ->assertOk();
        }
        $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'payment.succeeded',
            'data' => ['payment_request_id' => 'pr-tu-reconcile-2', 'amount' => 500],
        ], ['x-callback-token' => 'test-webhook-token'])->assertOk();

        $this->assertEquals(600.00, (float) $this->user->fresh()->wallet_balance);
        $this->assertEquals(1, WalletTransaction::where('user_id', $this->user->id)
            ->where('type', 'top_up')->where('status', 'completed')->count());
    }

    public function test_status_probe_reconcile_marks_a_failed_charge_failed_without_crediting(): void
    {
        $tx = $this->pendingEwalletTopUp('pr-tu-reconcile-3');

        Http::fake([
            'api.xendit.co/payment_requests/pr-tu-reconcile-3' => Http::response([
                'id' => 'pr-tu-reconcile-3', 'status' => 'FAILED',
            ], 200),
        ]);

        $this->actingAs($this->user)
            ->getJson("/api/v1/wallet/transactions/{$tx->id}/status")
            ->assertOk()
            ->assertJsonPath('data.status', 'failed');

        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);
        $this->assertNotNull($tx->fresh()->failure_reason);
    }

    public function test_status_probe_leaves_a_still_pending_charge_pending(): void
    {
        $tx = $this->pendingEwalletTopUp('pr-tu-reconcile-4');

        // The customer hasn't approved in GCash yet — the probe must NOT invent
        // a terminal state (a false 'failed' here would tell them a payment
        // they are mid-way through has died).
        Http::fake([
            'api.xendit.co/payment_requests/pr-tu-reconcile-4' => Http::response([
                'id' => 'pr-tu-reconcile-4', 'status' => 'REQUIRES_ACTION',
            ], 200),
        ]);

        $this->actingAs($this->user)
            ->getJson("/api/v1/wallet/transactions/{$tx->id}/status")
            ->assertOk()
            ->assertJsonPath('data.status', 'pending');

        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);
    }

    public function test_status_probe_survives_a_gateway_error_without_failing_the_poll(): void
    {
        $tx = $this->pendingEwalletTopUp('pr-tu-reconcile-5');

        // Xendit down / key rejected. The poll must degrade to "still pending",
        // never a 5xx and never a fabricated failure.
        Http::fake([
            'api.xendit.co/payment_requests/pr-tu-reconcile-5' => Http::response([], 500),
        ]);

        $this->actingAs($this->user)
            ->getJson("/api/v1/wallet/transactions/{$tx->id}/status")
            ->assertOk()
            ->assertJsonPath('data.status', 'pending');

        $this->assertEquals('pending', $tx->fresh()->status);
        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);
    }

    public function test_pending_topup_row_carries_its_resume_url_but_not_the_gateway_ref(): void
    {
        // Contract the wallet ledger's "Continue payment" affordance depends on:
        // a pending top-up row must still carry the checkout URL so the customer
        // can reopen the invoice they were already sent to (instead of starting
        // a duplicate top-up), while the gateway internal stays hidden.
        WalletTransaction::create([
            'user_id' => $this->user->id, 'type' => 'top_up', 'amount' => 500,
            'balance_after' => 100, 'status' => 'pending', 'gateway_ref' => 'inv_resume',
            'checkout_url' => 'https://checkout.xendit.co/inv_resume',
            'description' => 'Wallet top-up (awaiting payment)',
        ]);

        $this->actingAs($this->user)
            ->getJson('/api/v1/wallet/transactions')
            ->assertOk()
            ->assertJsonPath('data.0.checkout_url', 'https://checkout.xendit.co/inv_resume')
            ->assertJsonMissingPath('data.0.gateway_ref');
    }

    public function test_status_probe_does_not_pull_for_a_hosted_invoice_topup(): void
    {
        // A card/hosted-invoice ref is not a payment_request id, so the pull is
        // skipped entirely (those remain webhook-settled) — no stray gateway
        // call, and certainly no mis-addressed lookup.
        Http::fake();
        $tx = $this->legacyTopUp('inv_reconcile_1');

        $this->actingAs($this->user)
            ->getJson("/api/v1/wallet/transactions/{$tx->id}/status")
            ->assertOk()
            ->assertJsonPath('data.status', 'pending');

        Http::assertNotSent(fn ($request) => str_contains($request->url(), '/payment_requests/'));
    }
}
