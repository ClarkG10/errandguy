<?php

namespace Tests\Feature\Payment;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The charge that outlives the booking.
 *
 * A wallet-funded booking used to debit the customer in one committed
 * transaction and only THEN, across three further statements, record the paid
 * flag. A fatal in that window (deploy restart, OOM) left a committed `payment`
 * ledger row against a booking still carrying the migration default 'unpaid' —
 * and nothing recovered it. The auto-cancel refund declines on
 * `payment_status !== 'paid'`, and reconcile-wallets stays silent because the
 * debit is internally consistent: balance still equals the ledger. The customer
 * was charged for an errand that was then cancelled, silently and permanently.
 *
 * These lock down both halves of the fix: the debit and the paid flag now
 * commit or roll back together, and the detective sweep can see the orphan if
 * that seam ever drifts again.
 */
class WalletBookingAtomicityTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();

        $this->customer = User::factory()->create([
            'role' => 'customer',
            'status' => 'active',
            'wallet_balance' => 1000.00,
        ]);

        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeBooking(array $overrides = []): Booking
    {
        return Booking::create(array_merge([
            'booking_number' => 'EG-20260907-ATOM',
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->errandType->id,
            'status' => 'pending',
            'payment_status' => 'unpaid',
            'payment_method' => 'wallet',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ], $overrides));
    }

    /**
     * The invariant, expressed directly: a crash anywhere between the debit and
     * the paid flag must leave the customer's money where it was. Simulated by
     * doing the debit inside a transaction that then throws — which is exactly
     * the shape the booking flow now uses.
     */
    public function test_a_failure_after_the_debit_returns_the_money(): void
    {
        $booking = $this->makeBooking();

        try {
            DB::transaction(function () use ($booking) {
                app(\App\Services\WalletService::class)->deduct(
                    $this->customer->id,
                    115.00,
                    $booking->id,
                    "Payment for booking {$booking->booking_number}",
                );

                // Stand-in for the fatal that used to strand the debit.
                throw new \RuntimeException('process died before the booking recorded the payment');
            });
            $this->fail('the transaction should have propagated the failure');
        } catch (\RuntimeException) {
            // expected
        }

        $this->assertEquals(
            1000.00,
            (float) $this->customer->fresh()->wallet_balance,
            'the debit must roll back with the booking that never recorded it',
        );
        $this->assertSame(
            0,
            WalletTransaction::where('reference_id', $booking->id)->where('type', 'payment')->count(),
            'no orphaned payment row may survive the rollback',
        );
    }

    public function test_the_detective_sweep_flags_a_charge_with_no_refund(): void
    {
        // The end state the old bug produced: money taken, errand cancelled,
        // nothing returned. reconcile-wallets cannot see this — balance and
        // ledger still agree — so this sweep is the only thing that can.
        $booking = $this->makeBooking(['status' => 'cancelled', 'cancellation_fee' => 0]);

        WalletTransaction::create([
            'user_id' => $this->customer->id,
            'type' => 'payment',
            'amount' => -115.00,
            'balance_after' => 885.00,
            'reference_id' => $booking->id,
            'description' => 'Payment for booking',
        ]);

        $this->artisan('errandguy:reconcile-booking-payments')->assertSuccessful();

        $this->assertDatabaseHas('admin_alerts', ['type' => 'charged_unrefunded_cancellation']);
    }

    public function test_a_full_cancellation_fee_is_not_flagged(): void
    {
        // Keeping the whole charge as a fee is legitimate and writes no refund
        // row — it must not be reported as an orphan forever.
        $booking = $this->makeBooking(['status' => 'cancelled', 'cancellation_fee' => 115.00]);

        WalletTransaction::create([
            'user_id' => $this->customer->id,
            'type' => 'payment',
            'amount' => -115.00,
            'balance_after' => 885.00,
            'reference_id' => $booking->id,
            'description' => 'Payment for booking',
        ]);

        $this->artisan('errandguy:reconcile-booking-payments')->assertSuccessful();

        $this->assertDatabaseMissing('admin_alerts', ['type' => 'charged_unrefunded_cancellation']);
    }

    public function test_a_refunded_cancellation_is_not_flagged(): void
    {
        $booking = $this->makeBooking(['status' => 'cancelled', 'cancellation_fee' => 0]);

        foreach ([['payment', -115.00], ['refund', 115.00]] as [$type, $amount]) {
            WalletTransaction::create([
                'user_id' => $this->customer->id,
                'type' => $type,
                'amount' => $amount,
                'balance_after' => 1000.00,
                'reference_id' => $booking->id,
                'description' => 'test',
            ]);
        }

        $this->artisan('errandguy:reconcile-booking-payments')->assertSuccessful();

        $this->assertDatabaseMissing('admin_alerts', ['type' => 'charged_unrefunded_cancellation']);
    }
}
