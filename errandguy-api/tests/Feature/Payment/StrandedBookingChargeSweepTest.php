<?php

namespace Tests\Feature\Payment;

use App\Enums\PaymentStatus;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The stranded booking charge — the primary revenue path's missing safety net.
 *
 * Top-ups and payouts each had a scheduled sweep for a dropped webhook. The
 * booking charge did not: its only pull-reconcile is the customer's status poll,
 * which stops the moment they dismiss the pending sheet. So a delayed webhook
 * plus a customer who walks away leaked in BOTH directions — a genuinely paid
 * booking left 'pending' credits the runner nothing at completion, and an
 * abandoned checkout stays live so a runner works an errand nobody paid for.
 *
 * These lock down that the sweep settles both directions through the SAME
 * reconcile path the poll uses, and that the detective query can see a delivered
 * errand whose money never arrived.
 */
class StrandedBookingChargeSweepTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private Booking $booking;
    private Payment $payment;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
        config(['services.xendit.secret_key' => 'test-secret']);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 0]);

        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        $this->booking = Booking::create([
            'booking_number' => 'EG-20260906-SWEEP',
            'customer_id' => $this->customer->id,
            'runner_id' => $this->runner->id,
            'errand_type_id' => $errandType->id,
            'status' => 'accepted',
            'payment_status' => 'pending',
            'payment_method' => 'gcash',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);

        $this->payment = Payment::create([
            'booking_id' => $this->booking->id,
            'customer_id' => $this->customer->id,
            'amount' => 115.00,
            'currency' => 'PHP',
            'method' => 'gcash',
            'status' => PaymentStatus::Processing->value,
            'gateway_tx_id' => 'pr_sweep_1',
        ]);

        // Past --min-age, so the webhook has already had its chance.
        $this->payment->forceFill(['created_at' => now()->subMinutes(30)])->save();
        $this->payment->refresh();
    }

    private function fakeGateway(string $status): void
    {
        Http::preventStrayRequests();
        Http::fake([
            'api.xendit.co/payment_requests/*' => Http::response(
                ['id' => 'pr_sweep_1', 'status' => $status, 'amount' => 115],
                200,
            ),
        ]);
    }

    public function test_a_paid_but_unwebhooked_booking_charge_is_settled(): void
    {
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-booking-payments')->assertSuccessful();

        $this->assertSame(PaymentStatus::Completed->value, $this->payment->fresh()->status);
        $this->assertSame('paid', $this->booking->fresh()->payment_status);
    }

    public function test_an_abandoned_checkout_releases_the_runner(): void
    {
        $this->fakeGateway('FAILED');

        $this->artisan('errandguy:reconcile-booking-payments')->assertSuccessful();

        $this->assertSame('cancelled', $this->booking->fresh()->status);
    }

    /**
     * The sweep runs every 15 minutes forever — a second pass over an
     * already-settled charge must change nothing and must not credit twice.
     */
    public function test_running_the_sweep_twice_settles_once(): void
    {
        $this->fakeGateway('SUCCEEDED');

        $this->artisan('errandguy:reconcile-booking-payments')->assertSuccessful();
        $this->artisan('errandguy:reconcile-booking-payments')->assertSuccessful();

        $earnings = WalletTransaction::where('user_id', $this->runner->id)
            ->where('reference_id', $this->booking->id)
            ->whereIn('type', ['earning', 'commission'])
            ->count();

        $this->assertLessThanOrEqual(1, $earnings, 'a repeated sweep must never credit the runner twice');
        $this->assertSame('paid', $this->booking->fresh()->payment_status);
    }

    public function test_a_delivered_errand_with_no_settled_payment_is_flagged(): void
    {
        // The end state every leak in this family produces: service given, money
        // never collected, runner credited nothing — and nothing else looks for it.
        $this->booking->update(['status' => 'completed', 'payment_status' => 'pending']);
        $this->payment->forceFill(['status' => PaymentStatus::Failed->value])->save();

        $this->artisan('errandguy:reconcile-booking-payments')->assertSuccessful();

        $this->assertDatabaseHas('admin_alerts', ['type' => 'completed_unpaid_booking']);
    }

    public function test_a_cash_errand_is_never_flagged_as_unpaid(): void
    {
        // Cash settles at completion by design.
        $this->booking->update(['status' => 'completed', 'payment_status' => 'pending', 'payment_method' => 'cash']);
        $this->payment->forceFill(['status' => PaymentStatus::Failed->value])->save();

        $this->artisan('errandguy:reconcile-booking-payments')->assertSuccessful();

        $this->assertDatabaseMissing('admin_alerts', ['type' => 'completed_unpaid_booking']);
    }
}
