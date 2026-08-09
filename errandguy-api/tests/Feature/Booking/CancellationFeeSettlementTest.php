<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * PRICE-3 / PRICE-4 regression for the cancellation fee actually recorded:
 *   - PRICE-4: the kept fee is capped at the fare the customer paid, so a flat
 *     ₱20 fee can never swallow more than a ₱15 errand and preview == settlement.
 *   - PRICE-3: when nothing was collected (cash / unpaid) no fee is recorded —
 *     no phantom "a fee was applied" the customer is never actually charged.
 */
class CancellationFeeSettlementTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        Event::fake();
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 0]);
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50.00, 'per_km_walk' => 15.00, 'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00,
            'per_km_car' => 18.00, 'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeBooking(string $status, string $method, ?string $paymentStatus, float $total): Booking
    {
        $booking = Booking::create([
            'booking_number' => 'EG-20260808-'.strtoupper(substr(md5($status.$method.$total), 0, 4)),
            'customer_id' => $this->customer->id, 'errand_type_id' => $this->errandType->id, 'status' => $status,
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => $total, 'runner_payout' => round($total - 15, 2),
            'payment_method' => $method, 'payment_status' => $paymentStatus, 'is_transportation' => false,
        ]);
        if ($paymentStatus === 'paid') {
            Payment::create([
                'booking_id' => $booking->id, 'customer_id' => $this->customer->id, 'amount' => $total,
                'currency' => 'PHP', 'method' => $method, 'status' => 'completed', 'paid_at' => now(),
            ]);
        }

        return $booking;
    }

    private function cancel(Booking $booking): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/cancel", ['reason' => 'changed my mind']);
    }

    public function test_flat_fee_is_capped_at_the_fare_on_a_cheap_paid_errand(): void
    {
        // Accepted tier → ₱20 flat policy fee, but the paid fare is only ₱15.
        $booking = $this->makeBooking('accepted', 'gcash', 'paid', total: 15);

        $this->cancel($booking)->assertOk();

        // Fee recorded is the capped ₱15, not the ₱20 policy number.
        $this->assertEquals('15.00', $booking->fresh()->cancellation_fee);
        // Refundable = fare − fee = 0 → no refund row, customer keeps nothing back.
        $this->assertDatabaseMissing('wallet_transactions', ['user_id' => $this->customer->id, 'type' => 'refund']);
    }

    public function test_cash_cancellation_records_no_phantom_fee(): void
    {
        // Nothing was collected on a cash booking → no fee is charged/recorded.
        $booking = $this->makeBooking('accepted', 'cash', 'unpaid', total: 200);

        $response = $this->cancel($booking)->assertOk();

        $this->assertEquals('0.00', $booking->fresh()->cancellation_fee);
        $response->assertJsonPath('cancellation.fee', 0);
    }

    public function test_paid_flat_fee_kept_and_remainder_refunded(): void
    {
        // Accepted tier → ₱20 flat fee on a ₱200 paid fare (fee well under the
        // fare, no cap needed). The ₱180 remainder is refunded to the wallet.
        // Confirms normal behaviour is preserved by the cap/zero logic.
        $booking = $this->makeBooking('accepted', 'gcash', 'paid', total: 200);

        $this->cancel($booking)->assertOk();

        $this->assertEquals('20.00', $booking->fresh()->cancellation_fee);
        $this->assertEquals('refunded', $booking->fresh()->payment_status);
        $this->assertEquals('180.00', $this->customer->fresh()->wallet_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund', 'reference_id' => $booking->id, 'amount' => '180.00',
        ]);
    }
}
