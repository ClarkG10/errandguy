<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\User;
use Database\Seeders\SystemConfigSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * The cancelled errand's money story, on the two surfaces that outlive the
 * cancel toast:
 *
 *  1. GET /bookings/{id}/cancel-preview — quotes the fee AND what comes back,
 *     and where it lands. Without the refund figure the confirm modal reads
 *     "a ₱20 fee applies / Cancel & pay ₱20" to a customer who has already
 *     been charged ₱500, and never mentions the ₱480 returning to their
 *     wallet.
 *  2. BookingResource — carries refunded_amount / refund_destination so the
 *     receipt and the activity detail sheet can show, days later, what the
 *     errand actually cost. Previously the fee was exposed and the refund it
 *     was deducted from was not, so a cancelled prepaid booking still showed
 *     its full original total with no trace of the money returned.
 */
class CancellationMoneyOutcomeTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(SystemConfigSeeder::class);
        Event::fake();
        $this->customer = User::factory()->create([
            'role' => 'customer', 'status' => 'active', 'wallet_balance' => 0,
        ]);
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50.00, 'per_km_walk' => 15.00, 'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00,
            'per_km_car' => 18.00, 'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeBooking(string $status, string $method, ?string $paymentStatus, float $total): Booking
    {
        $booking = Booking::create([
            'booking_number' => 'EG-20260903-'.strtoupper(substr(md5($status.$method.$total.uniqid()), 0, 4)),
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

    private function preview(Booking $booking): TestResponse
    {
        return $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$booking->id}/cancel-preview");
    }

    // ── cancel-preview ────────────────────────────────────────────────────

    public function test_preview_quotes_the_refund_and_its_destination_on_a_paid_booking(): void
    {
        // Accepted tier → ₱20 flat fee on a ₱500 prepaid fare.
        $booking = $this->makeBooking('accepted', 'gcash', 'paid', total: 500);

        $this->preview($booking)
            ->assertOk()
            ->assertJsonPath('data.fee', 20)
            ->assertJsonPath('data.cancellable', true)
            // The number the customer actually cares about, and where it goes.
            ->assertJsonPath('data.refund_amount', 480)
            ->assertJsonPath('data.refund_destination', 'wallet');
    }

    public function test_preview_refunds_the_whole_fare_in_the_free_window(): void
    {
        // Pre-match: no fee, so everything collected comes back.
        $booking = $this->makeBooking('pending', 'gcash', 'paid', total: 500);

        $this->preview($booking)
            ->assertOk()
            ->assertJsonPath('data.fee', 0)
            ->assertJsonPath('data.refund_amount', 500)
            ->assertJsonPath('data.refund_destination', 'wallet');
    }

    public function test_preview_promises_nothing_back_on_a_cash_booking(): void
    {
        // Nothing was collected up front, so there is no fee (PRICE-3) and
        // nothing to return — the modal must not imply a refund is coming.
        $booking = $this->makeBooking('accepted', 'cash', 'unpaid', total: 500);

        $this->preview($booking)
            ->assertOk()
            ->assertJsonPath('data.fee', 0)
            ->assertJsonPath('data.refund_amount', 0)
            ->assertJsonPath('data.refund_destination', null);
    }

    public function test_preview_promises_nothing_back_when_the_capped_fee_eats_the_fare(): void
    {
        // ₱20 flat policy fee on a ₱15 paid fare → fee capped at ₱15, refund 0.
        $booking = $this->makeBooking('accepted', 'gcash', 'paid', total: 15);

        $this->preview($booking)
            ->assertOk()
            ->assertJsonPath('data.fee', 15)
            ->assertJsonPath('data.refund_amount', 0)
            ->assertJsonPath('data.refund_destination', null);
    }

    // ── BookingResource, after the fact ───────────────────────────────────

    public function test_cancelled_paid_booking_reports_fee_and_refund_afterwards(): void
    {
        $booking = $this->makeBooking('accepted', 'gcash', 'paid', total: 500);

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/cancel", ['reason' => 'changed my mind'])
            ->assertOk();

        // Re-opened from Activity days later: the fee, the refund and where it
        // went are all on the booking itself.
        $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$booking->id}")
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.cancellation_reason', 'changed my mind')
            ->assertJsonPath('data.cancellation_fee', '20.00')
            ->assertJsonPath('data.refunded_amount', 480)
            ->assertJsonPath('data.refund_destination', 'wallet');
    }

    public function test_cancelled_cash_booking_claims_no_refund(): void
    {
        $booking = $this->makeBooking('accepted', 'cash', 'unpaid', total: 500);

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/cancel", ['reason' => 'not needed'])
            ->assertOk();

        // Nothing was collected, so nothing was returned — null, never a
        // phantom "₱500 refunded".
        $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$booking->id}")
            ->assertOk()
            ->assertJsonPath('data.cancellation_fee', '0.00')
            ->assertJsonPath('data.refunded_amount', null)
            ->assertJsonPath('data.refund_destination', null);
    }

    public function test_live_paid_booking_reports_no_refund_yet(): void
    {
        // An in-flight errand has collected money but returned none of it.
        $booking = $this->makeBooking('accepted', 'gcash', 'paid', total: 500);

        $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$booking->id}")
            ->assertOk()
            ->assertJsonPath('data.refunded_amount', null)
            ->assertJsonPath('data.refund_destination', null);
    }
}
