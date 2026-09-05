<?php

namespace Tests\Feature\Payment;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The stranded gateway tip.
 *
 * A gateway-funded tip charges the customer and leaves a pending `tip_payment`
 * row; the runner is credited only when the webhook lands. Unlike top-ups and
 * payouts, that had NO fallback on any path: the status endpoint routes tips
 * through reconcilePendingTopUp, which early-returned on anything that wasn't a
 * top-up, and neither scheduled sweep looked at `tip_payment`. One dropped
 * webhook and the customer's money was captured at the gateway while the runner
 * was never credited — with no recovery, automated or manual, and the customer's
 * app sitting on an honest "we'll notify you" that never came.
 *
 * These lock down both halves of the fix: the read path settles a tip, and the
 * sweep catches the customer who never reopens the app.
 */
class StrandedGatewayTipTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private Booking $booking;
    private WalletTransaction $tip;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
        config(['services.xendit.secret_key' => 'test-secret']);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 0]);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 0]);

        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        $this->booking = Booking::create([
            'booking_number' => 'EG-20260906-TIP',
            'customer_id' => $this->customer->id,
            'runner_id' => $this->runner->id,
            'errand_type_id' => $errandType->id,
            'status' => 'completed',
            'payment_status' => 'paid',
            'payment_method' => 'gcash',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);

        $this->tip = WalletTransaction::create([
            'user_id' => $this->customer->id,
            'reference_id' => $this->booking->id,
            'type' => 'tip_payment',
            'status' => 'pending',
            'amount' => 50,
            'balance_after' => 0,
            'gateway_ref' => 'pr_tip_1',
            'description' => 'Tip (awaiting payment)',
        ]);

        // Past --min-age, so the webhook has already had its chance.
        $this->tip->forceFill(['created_at' => now()->subMinutes(30)])->save();
        $this->tip->refresh();
    }

    private function fakeGateway(string $status): void
    {
        Http::preventStrayRequests();
        Http::fake([
            'api.xendit.co/payment_requests/*' => Http::response(
                ['id' => 'pr_tip_1', 'status' => $status, 'amount' => 50],
                200,
            ),
        ]);
    }

    private function assertRunnerWasTipped(): void
    {
        $this->assertSame('completed', $this->tip->fresh()->status);
        $this->assertEquals(50.00, (float) $this->booking->fresh()->tip_amount);
        $this->assertSame(
            1,
            WalletTransaction::where('user_id', $this->runner->id)
                ->where('reference_id', $this->booking->id)
                ->where('type', 'tip')
                ->count(),
            'the runner should be credited exactly one tip'
        );
    }

    public function test_the_read_path_now_settles_a_paid_tip(): void
    {
        // This is what the customer's status poll hits — it used to early-return
        // on any non-top-up, so a tip could never settle here.
        $this->fakeGateway('SUCCEEDED');

        app(WalletService::class)->reconcilePendingTopUp($this->tip, 0);

        $this->assertRunnerWasTipped();
    }

    public function test_the_sweep_credits_a_tip_the_customer_walked_away_from(): void
    {
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-topups')->assertSuccessful();

        $this->assertRunnerWasTipped();
    }

    public function test_a_declined_tip_is_closed_and_never_credits_the_runner(): void
    {
        $this->fakeGateway('FAILED');

        $this->artisan('errandguy:reconcile-topups')->assertSuccessful();

        $this->assertContains($this->tip->fresh()->status, ['failed', 'expired', 'cancelled']);
        $this->assertEquals(0.00, (float) $this->runner->fresh()->wallet_balance);
    }

    /**
     * The sweep runs every 15 minutes forever — a replay must not tip twice.
     */
    public function test_running_the_sweep_twice_tips_once(): void
    {
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-topups')->assertSuccessful();
        $this->artisan('errandguy:reconcile-topups')->assertSuccessful();

        $this->assertRunnerWasTipped();
        $this->assertEquals(50.00, (float) $this->runner->fresh()->wallet_balance);
    }
}
