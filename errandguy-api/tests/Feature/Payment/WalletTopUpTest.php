<?php

namespace Tests\Feature\Payment;

use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

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

    public function test_top_up_creates_pending_transaction_and_does_not_credit_balance(): void
    {
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_123',
                'invoice_url' => 'https://checkout.xendit.co/inv_123',
            ], 200),
        ]);

        $response = $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 500]);

        $response->assertCreated()
            ->assertJsonPath('checkout_url', 'https://checkout.xendit.co/inv_123')
            ->assertJsonPath('data.status', 'pending');

        // Balance must be UNCHANGED until the webhook confirms payment.
        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);

        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->user->id,
            'type' => 'top_up',
            'status' => 'pending',
            'gateway_ref' => 'inv_123',
        ]);
    }

    public function test_ewallet_topup_returns_a_direct_deep_link_not_a_hosted_invoice(): void
    {
        // method=gcash → Payment Requests API: checkout_url is the wallet
        // authorization deep-link, not a hosted invoice page.
        Http::fake([
            'api.xendit.co/payment_requests' => Http::response([
                'id' => 'pr_tu', 'status' => 'PENDING',
                'actions' => [['url' => 'https://gcash.example/authorize/pr_tu']],
            ], 200),
        ]);

        $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 500, 'method' => 'gcash'])
            ->assertCreated()
            ->assertJsonPath('checkout_url', 'https://gcash.example/authorize/pr_tu')
            ->assertJsonPath('data.status', 'pending');

        Http::assertSent(fn ($r) => str_contains($r->url(), '/payment_requests'));
        Http::assertNotSent(fn ($r) => str_contains($r->url(), '/v2/invoices'));
        // gateway_ref = payment_request id so payment.succeeded matches it.
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->user->id, 'type' => 'top_up', 'status' => 'pending', 'gateway_ref' => 'pr_tu',
        ]);
        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);
    }

    public function test_payment_succeeded_webhook_credits_a_direct_ewallet_topup(): void
    {
        Http::fake([
            'api.xendit.co/payment_requests' => Http::response([
                'id' => 'pr_tu2', 'status' => 'PENDING',
                'actions' => [['url' => 'https://gcash.example/authorize/pr_tu2']],
            ], 200),
        ]);
        $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 500, 'method' => 'gcash'])
            ->assertCreated();
        $tx = WalletTransaction::where('user_id', $this->user->id)->firstOrFail();

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
        Http::fake([
            'api.xendit.co/payment_requests' => Http::response([
                'id' => 'pr_tu3', 'status' => 'PENDING',
                'actions' => [['url' => 'https://gcash.example/authorize/pr_tu3']],
            ], 200),
        ]);
        $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 500, 'method' => 'gcash'])
            ->assertCreated();
        $tx = WalletTransaction::where('user_id', $this->user->id)->firstOrFail();

        $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'payment.failed',
            'data' => ['payment_request_id' => 'pr_tu3'],
        ], ['x-callback-token' => 'test-webhook-token'])->assertOk();

        $this->assertEquals('failed', $tx->fresh()->status);
        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);
    }

    public function test_invoice_paid_webhook_credits_wallet(): void
    {
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_abc',
                'invoice_url' => 'https://checkout.xendit.co/inv_abc',
            ], 200),
        ]);

        $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 500])
            ->assertCreated();

        $tx = WalletTransaction::where('user_id', $this->user->id)->firstOrFail();

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
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_flat', 'invoice_url' => 'https://checkout.xendit.co/inv_flat',
            ], 200),
        ]);

        $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 500])
            ->assertCreated();
        $tx = WalletTransaction::where('user_id', $this->user->id)->firstOrFail();

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
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_xyz', 'invoice_url' => 'https://checkout.xendit.co/inv_xyz',
            ], 200),
        ]);

        $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 300])
            ->assertCreated();
        $tx = WalletTransaction::where('user_id', $this->user->id)->firstOrFail();

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

    public function test_top_up_below_minimum_is_rejected(): void
    {
        $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 10])
            ->assertStatus(422);
    }

    public function test_gateway_rejection_returns_a_clean_422_never_a_masked_5xx(): void
    {
        // Simulate Xendit rejecting the request (e.g. the API key lacks the
        // Invoice permission — the real-world REQUEST_FORBIDDEN_ERROR).
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'error_code' => 'REQUEST_FORBIDDEN_ERROR',
                'message' => 'The API key is forbidden to perform this request.',
            ], 403),
        ]);

        $response = $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 500]);

        // A gateway rejection must surface as a clean, honest 422 through the
        // standardized envelope — never a 502/503 (Cloudflare masks those and
        // the mobile client discards >=500 messages). The friendly copy tells
        // the user they weren't charged, and the raw gateway text never leaks.
        $response->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonPath('code', 'PAYMENT_GATEWAY_ERROR');
        $this->assertStringContainsString('weren’t charged', (string) $response->json('message'));
        $this->assertStringNotContainsString('API key is forbidden', (string) $response->json('message'));

        // Balance untouched, and the pending row is marked failed (not left
        // lingering as a fake "pending top-up").
        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->user->id,
            'type' => 'top_up',
            'status' => 'failed',
        ]);
    }

    // ── Pull-reconcile on the top-up status probe ───────────────────────────
    // Top-up used to be the ONLY money-in flow with no pull path: the booking
    // probe asks Xendit when a webhook lags, but this endpoint just re-read the
    // DB row — so a delayed/dropped webhook stranded a customer whose money had
    // already left GCash on "Payment is being processed" indefinitely.

    /** Create a pending e-wallet top-up and return its transaction. */
    private function pendingEwalletTopUp(string $prId, float $amount = 500): WalletTransaction
    {
        Http::fake([
            'api.xendit.co/payment_requests' => Http::response([
                'id' => $prId, 'status' => 'PENDING',
                'actions' => [['url' => "https://gcash.example/authorize/{$prId}"]],
            ], 200),
        ]);
        $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => $amount, 'method' => 'gcash'])
            ->assertCreated();

        return WalletTransaction::where('user_id', $this->user->id)
            ->where('gateway_ref', $prId)
            ->firstOrFail();
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
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_reconcile_1', 'invoice_url' => 'https://checkout.xendit.co/inv_reconcile_1',
            ], 200),
        ]);
        $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 500])
            ->assertCreated();
        $tx = WalletTransaction::where('gateway_ref', 'inv_reconcile_1')->firstOrFail();

        $this->actingAs($this->user)
            ->getJson("/api/v1/wallet/transactions/{$tx->id}/status")
            ->assertOk()
            ->assertJsonPath('data.status', 'pending');

        Http::assertNotSent(fn ($request) => str_contains($request->url(), '/payment_requests/'));
    }
}
