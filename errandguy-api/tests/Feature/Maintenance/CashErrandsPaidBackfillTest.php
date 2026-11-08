<?php

namespace Tests\Feature\Maintenance;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** The one-time fix for finished cash errands stored as 'unpaid'. */
class CashErrandsPaidBackfillTest extends TestCase
{
    use RefreshDatabase;

    private function booking(string $status, string $method, string $paymentRow): Booking
    {
        static $type = null;
        $type ??= ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $booking = Booking::create([
            'booking_number' => 'EG-BF-'.strtoupper(substr(md5(uniqid('', true)), 0, 6)),
            'customer_id' => $customer->id, 'errand_type_id' => $type->id, 'status' => $status,
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0,
            'total_amount' => 140, 'runner_payout' => 125,
            'payment_method' => $method, 'payment_status' => 'unpaid', 'is_transportation' => false,
        ]);
        Payment::create([
            'booking_id' => $booking->id, 'customer_id' => $customer->id, 'amount' => 140,
            'method' => $method, 'status' => $paymentRow,
        ]);

        return $booking;
    }

    public function test_only_collected_cash_errands_become_paid(): void
    {
        $collected = $this->booking('completed', 'cash', 'completed');
        $notCollected = $this->booking('completed', 'cash', 'pending');
        $cancelled = $this->booking('cancelled', 'cash', 'completed');
        $online = $this->booking('completed', 'gcash', 'completed');

        (require database_path('migrations/2026_11_08_000003_mark_collected_cash_errands_paid.php'))->up();

        $this->assertSame('paid', $collected->fresh()->payment_status);
        $this->assertSame('unpaid', $notCollected->fresh()->payment_status);
        $this->assertSame('unpaid', $cancelled->fresh()->payment_status);
        $this->assertSame('unpaid', $online->fresh()->payment_status, 'an online charge is the reconciler’s to judge');
    }
}
