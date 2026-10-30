<?php

namespace Tests\Feature\Payment;

use App\Models\AdminAlert;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Gateway-funded tips: a customer with NO wallet balance tips their runner by
 * paying directly with GCash or Maya. The runner is credited only after
 * Xendit confirms — never optimistically — and the credit is the same
 * (runner, booking, 'tip') row shape the wallet-funded tip writes.
 *
 * Every started charge is its own row. One row used to be reused for every
 * attempt, so switching from GCash to Maya overwrote the first charge's
 * reference and approving that first charge later took the customer's money
 * and credited nobody. Now each charge settles on its own: the first to
 * succeed pays the runner, and any other that also succeeds is refunded to the
 * customer's wallet — tracked, never dropped.
 */
class GatewayTipTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $errandType;

    /** The id Xendit gives the next charge started. */
    private string $nextCharge = 'pr_unset';

    /** What a pull of a charge reports, by charge id (default: not yet approved). */
    private array $gateway = [];

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.xendit.secret_key' => 'test-secret']);
        config(['services.xendit.webhook_token' => 'test-webhook-token']);

        // A DELIBERATELY zero-wallet customer — the whole point of the gateway
        // path is that they can tip without any ErrandGuy balance.
        $this->customer = User::factory()->create([
            'role' => 'customer', 'status' => 'active',
            'wallet_balance' => 0, 'email' => 'buyer@example.com',
        ]);
        $this->runner = User::factory()->create([
            'role' => 'runner', 'status' => 'active', 'wallet_balance' => 0,
        ]);
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'is_active' => true, 'sort_order' => 1,
        ]);

        // Starting a charge answers with $nextCharge; pulling one answers with
        // whatever $gateway says about it.
        Http::fake(function ($request) {
            $path = (string) parse_url($request->url(), PHP_URL_PATH);
            if ($request->method() === 'POST' && $path === '/payment_requests') {
                return Http::response([
                    'id' => $this->nextCharge, 'status' => 'REQUIRES_ACTION',
                    'actions' => [['url' => "https://wallet.example/authorize/{$this->nextCharge}"]],
                ]);
            }
            if (str_starts_with($path, '/payment_requests/')) {
                $id = basename($path);

                return Http::response(['id' => $id, ...($this->gateway[$id] ?? ['status' => 'REQUIRES_ACTION'])]);
            }

            return Http::response([], 404);
        });
    }

    private function makeCompletedBooking(array $overrides = []): Booking
    {
        return Booking::create(array_merge([
            'booking_number' => 'EG-TIP-'.strtoupper(substr(md5(microtime().random_int(0, 9999)), 0, 6)),
            'customer_id' => $this->customer->id,
            'runner_id' => $this->runner->id,
            'errand_type_id' => $this->errandType->id,
            'status' => 'completed',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => 'cash', 'payment_status' => 'paid',
            'is_transportation' => false, 'tip_amount' => 0,
        ], $overrides));
    }

    private function webhook(array $payload, ?string $webhookId = null)
    {
        return $this->postJson('/api/v1/webhooks/xendit', $payload, array_filter([
            'x-callback-token' => 'test-webhook-token',
            'webhook-id' => $webhookId,
        ]));
    }

    /**
     * Start a tip charge through the endpoint; Xendit answers with $prId, which
     * the customer hasn't approved yet. Returns the charge's own row.
     */
    private function startTip(Booking $booking, string $prId, float $amount = 50, string $method = 'gcash'): WalletTransaction
    {
        $this->nextCharge = $prId;

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip-checkout", ['amount' => $amount, 'method' => $method])
            ->assertCreated()
            ->assertJsonPath('checkout_url', "https://wallet.example/authorize/{$prId}")
            ->assertJsonPath('data.status', 'pending');

        return WalletTransaction::where('type', 'tip_payment')->where('gateway_ref', $prId)->firstOrFail();
    }

    private function succeeded(string $prId, float $amount, ?WalletTransaction $tip = null): void
    {
        $this->webhook([
            'event' => 'payment.succeeded',
            'data' => array_filter([
                'id' => "py-{$prId}",
                'payment_request_id' => $prId,
                'reference_id' => $tip ? "tip-{$tip->id}" : null,
                'amount' => $amount,
            ]),
        ], "wh-{$prId}")->assertOk();
    }

    public function test_checkout_creates_a_pending_row_for_the_charge_and_does_not_credit_the_runner_yet(): void
    {
        $booking = $this->makeCompletedBooking();

        $tip = $this->startTip($booking, 'pr_tip1');

        // Nothing moves until Xendit confirms.
        $this->assertSame(0.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(0.0, (float) $booking->fresh()->tip_amount);
        $this->assertSame($booking->id, $tip->booking_id);
        $this->assertSame('pending', $tip->status);
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $this->runner->id, 'reference_id' => $booking->id, 'type' => 'tip',
        ]);
        // A one-time GCash charge, named for this row.
        Http::assertSent(fn ($r) => $r->url() === 'https://api.xendit.co/payment_requests'
            && $r['reference_id'] === "tip-{$tip->id}"
            && $r['payment_method']['ewallet']['channel_code'] === 'GCASH');
    }

    public function test_a_card_tip_is_refused_with_a_clear_message(): void
    {
        $booking = $this->makeCompletedBooking();

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip-checkout", ['amount' => 50, 'method' => 'card'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Card payments are no longer available — please pay with GCash, Maya or your ErrandGuy wallet.');

        $this->assertSame(0, WalletTransaction::count());
        Http::assertNothingSent();
    }

    public function test_payment_succeeded_credits_the_runner_and_stamps_the_tip(): void
    {
        $booking = $this->makeCompletedBooking();
        $tip = $this->startTip($booking, 'pr_tip2', 75);

        $this->succeeded('pr_tip2', 75);

        // Runner credited, booking stamped, and the customer's wallet UNMOVED
        // (they paid via the gateway, not their ErrandGuy balance).
        $this->assertSame(75.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(75.0, (float) $booking->fresh()->tip_amount);
        $this->assertSame(0.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertSame('completed', $tip->fresh()->status);
        $this->assertSame('pr_tip2', $tip->fresh()->gateway_ref, 'the settling charge stays recorded on the row');
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->runner->id, 'reference_id' => $booking->id, 'type' => 'tip', 'amount' => 75,
        ]);
    }

    public function test_settling_the_same_charge_again_is_a_no_op(): void
    {
        $booking = $this->makeCompletedBooking();
        $tip = $this->startTip($booking, 'pr_tip3', 100);

        $this->succeeded('pr_tip3', 100);
        // A redelivery under another webhook id, and a racing pull.
        $this->webhook([
            'event' => 'payment.succeeded',
            'data' => ['id' => 'py-pr_tip3', 'payment_request_id' => 'pr_tip3', 'amount' => 100],
        ], 'wh-again')->assertOk();
        app(WalletService::class)->completeGatewayTip($tip->id, ['id' => 'pr_tip3', 'amount' => 100]);

        $this->assertSame(100.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(0.0, (float) $this->customer->fresh()->wallet_balance, 'a replay is never mistaken for an extra charge');
        $this->assertSame(1, WalletTransaction::where('user_id', $this->runner->id)
            ->where('reference_id', $booking->id)->where('type', 'tip')->count());
    }

    public function test_under_settlement_leaves_the_tip_pending_and_does_not_credit(): void
    {
        $booking = $this->makeCompletedBooking();
        $tip = $this->startTip($booking, 'pr_tip4', 100);

        // Gateway confirms LESS than the tip → must NOT credit.
        $this->succeeded('pr_tip4', 40);

        $this->assertSame(0.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(0.0, (float) $booking->fresh()->tip_amount);
        $this->assertSame('pending', $tip->fresh()->status);
    }

    public function test_payment_failed_marks_the_tip_failed_without_crediting(): void
    {
        $booking = $this->makeCompletedBooking();
        $tip = $this->startTip($booking, 'pr_tip6', 75);

        $this->webhook([
            'event' => 'payment.failed',
            'data' => ['payment_request_id' => 'pr_tip6'],
        ])->assertOk();

        $this->assertSame('failed', $tip->fresh()->status);
        $this->assertSame(0.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(0.0, (float) $booking->fresh()->tip_amount);
    }

    public function test_switching_from_gcash_to_maya_keeps_track_of_both_charges(): void
    {
        $booking = $this->makeCompletedBooking();

        // GCash started and abandoned, then Maya started: two charges, two rows.
        $first = $this->startTip($booking, 'pr_gcash', 50, 'gcash');
        $second = $this->startTip($booking, 'pr_maya', 50, 'maya');

        $this->assertNotSame($first->id, $second->id);
        $this->assertSame('pr_gcash', $first->fresh()->gateway_ref, 'the first charge is never overwritten');
        $this->assertSame('pending', $first->fresh()->status);

        // The customer goes back and approves the FIRST one after all: the
        // runner is paid (this used to take the money and credit nobody).
        $this->succeeded('pr_gcash', 50);

        $this->assertSame(50.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(50.0, (float) $booking->fresh()->tip_amount);
        $this->assertSame('completed', $first->fresh()->status);
        $this->assertSame('pending', $second->fresh()->status);

        // ...and then approves the second as well: one tip per errand, so that
        // money comes back to the customer's (withdrawable) wallet.
        $this->succeeded('pr_maya', 50);

        $this->assertSame(50.0, (float) $this->runner->fresh()->wallet_balance, 'the runner is never paid twice');
        $this->assertSame(50.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertSame('refunded', $second->fresh()->status);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund', 'reference_id' => $second->id, 'amount' => 50,
        ]);
        $this->assertTrue(Notification::where('user_id', $this->customer->id)->where('title', 'Tip refunded to your wallet')->exists());
        $this->assertTrue(AdminAlert::where('type', 'tip_refunded')->exists());

        // Replaying the refunded charge refunds nothing more.
        $this->webhook([
            'event' => 'payment.succeeded',
            'data' => ['id' => 'py-pr_maya', 'payment_request_id' => 'pr_maya', 'amount' => 50],
        ], 'wh-maya-again')->assertOk();
        $this->assertSame(50.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_a_new_charge_is_refused_once_an_earlier_one_has_actually_been_paid(): void
    {
        $booking = $this->makeCompletedBooking();
        $first = $this->startTip($booking, 'pr_paid_quietly', 50);

        // The customer paid the first charge but its notice hasn't arrived;
        // asking Xendit before starting another settles it, so no second
        // charge is ever taken.
        $this->gateway['pr_paid_quietly'] = ['status' => 'SUCCEEDED', 'amount' => 50];

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip-checkout", ['amount' => 50, 'method' => 'maya'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'CONFLICT');

        $this->assertSame('completed', $first->fresh()->status);
        $this->assertSame(50.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(1, WalletTransaction::where('type', 'tip_payment')->count());
    }

    public function test_a_charge_landing_after_a_wallet_tip_is_refunded_not_double_paid(): void
    {
        $booking = $this->makeCompletedBooking();
        $tip = $this->startTip($booking, 'pr_tip7', 50);

        // Meanwhile the errand was tipped some other way.
        $booking->update(['tip_amount' => 30]);

        $this->succeeded('pr_tip7', 50);

        $this->assertSame(0.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(30.0, (float) $booking->fresh()->tip_amount);
        $this->assertSame('refunded', $tip->fresh()->status);
        $this->assertSame(50.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_a_charge_for_an_errand_with_no_runner_is_refunded(): void
    {
        $booking = $this->makeCompletedBooking();
        $tip = $this->startTip($booking, 'pr_norunner', 40);
        $booking->update(['runner_id' => null]);

        $this->succeeded('pr_norunner', 40);

        $this->assertSame('refunded', $tip->fresh()->status);
        $this->assertSame(40.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_a_charge_an_older_build_overwrote_is_refunded_and_the_rows_own_charge_still_pays(): void
    {
        // A tip row from before the fix: one row reused for every attempt, so
        // it now holds the SECOND charge while the first is still payable.
        $booking = $this->makeCompletedBooking();
        $legacy = WalletTransaction::create([
            'user_id' => $this->customer->id, 'type' => 'tip_payment', 'reference_id' => $booking->id,
            'amount' => 60, 'balance_after' => 0, 'status' => 'pending', 'gateway_ref' => 'pr_second',
            'description' => 'Tip (awaiting payment)',
        ]);

        // The overwritten first charge is approved: found by its reference,
        // and refunded to the customer rather than lost.
        $this->succeeded('pr_first', 50, $legacy);

        $this->assertSame(50.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertSame(0.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame('pending', $legacy->fresh()->status);

        // The row's own charge settles normally.
        $this->succeeded('pr_second', 60, $legacy);

        $this->assertSame(60.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame('completed', $legacy->fresh()->status);
        $this->assertSame(50.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_a_legacy_card_tip_invoice_still_settles(): void
    {
        // A card tip started before cards were retired.
        $booking = $this->makeCompletedBooking();
        $legacy = WalletTransaction::create([
            'user_id' => $this->customer->id, 'type' => 'tip_payment', 'reference_id' => $booking->id,
            'amount' => 50, 'balance_after' => 0, 'status' => 'pending', 'gateway_ref' => 'inv_tip_legacy',
            'description' => 'Tip (awaiting payment)',
        ]);

        $this->webhook([
            'event' => 'invoice.paid',
            'data' => ['external_id' => "tip-{$legacy->id}", 'id' => 'inv_tip_legacy', 'amount' => 50],
        ])->assertOk();

        $this->assertSame(50.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(50.0, (float) $booking->fresh()->tip_amount);
        $this->assertSame('completed', $legacy->fresh()->status);
    }

    public function test_cannot_gateway_tip_an_uncompleted_errand(): void
    {
        $booking = $this->makeCompletedBooking(['status' => 'in_transit']);

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip-checkout", ['amount' => 50, 'method' => 'gcash'])
            ->assertStatus(422)
            ->assertJsonPath('code', 'BOOKING_STATE_INVALID');
    }

    public function test_cannot_gateway_tip_an_already_tipped_errand(): void
    {
        $booking = $this->makeCompletedBooking(['tip_amount' => 20]);

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip-checkout", ['amount' => 50, 'method' => 'maya'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'CONFLICT');
    }
}
