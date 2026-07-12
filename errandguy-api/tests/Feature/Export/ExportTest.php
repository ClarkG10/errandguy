<?php

namespace Tests\Feature\Export;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ExportTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeCompletedBooking(): Booking
    {
        return Booking::create([
            'booking_number' => 'EG-20260709-EXP1',
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'completed',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false, 'completed_at' => now(),
        ]);
    }

    private function dompdfInstalled(): bool
    {
        return class_exists(\Barryvdh\DomPDF\Facade\Pdf::class);
    }

    public function test_earnings_export_requires_authentication(): void
    {
        $this->getJson('/api/v1/runner/earnings/export')->assertUnauthorized();
    }

    public function test_earnings_export_is_role_gated_to_runner(): void
    {
        // A customer must not reach the runner-only export route.
        $this->actingAs($this->customer)
            ->get('/api/v1/runner/earnings/export?period=this_month')
            ->assertForbidden();
    }

    public function test_runner_can_download_earnings_pdf(): void
    {
        if (! $this->dompdfInstalled()) {
            $this->markTestSkipped('barryvdh/laravel-dompdf not installed.');
        }

        $this->makeCompletedBooking();

        $response = $this->actingAs($this->runner)
            ->get('/api/v1/runner/earnings/export?period=this_month');

        $response->assertOk();
        $this->assertSame('application/pdf', $response->headers->get('content-type'));
    }

    public function test_receipt_pdf_owner_can_download(): void
    {
        $booking = $this->makeCompletedBooking();
        $payment = Payment::create([
            'booking_id' => $booking->id,
            'customer_id' => $this->customer->id,
            'amount' => 115.00,
            'currency' => 'PHP',
            'method' => 'wallet',
            'status' => 'paid',
            'paid_at' => now(),
        ]);

        if (! $this->dompdfInstalled()) {
            $this->markTestSkipped('barryvdh/laravel-dompdf not installed.');
        }

        $response = $this->actingAs($this->customer)
            ->get("/api/v1/payments/{$payment->id}/receipt/pdf");

        $response->assertOk();
        $this->assertSame('application/pdf', $response->headers->get('content-type'));
    }

    public function test_receipt_pdf_rejects_non_owner(): void
    {
        $booking = $this->makeCompletedBooking();
        $payment = Payment::create([
            'booking_id' => $booking->id,
            'customer_id' => $this->customer->id,
            'amount' => 115.00,
            'currency' => 'PHP',
            'method' => 'wallet',
            'status' => 'paid',
            'paid_at' => now(),
        ]);

        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->actingAs($other)
            ->get("/api/v1/payments/{$payment->id}/receipt/pdf")
            ->assertNotFound();
    }
}
