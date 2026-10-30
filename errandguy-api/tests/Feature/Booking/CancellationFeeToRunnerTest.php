<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\Payment;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * The ₱20 cancellation fee a customer pays for cancelling a prepaid errand
 * after a runner accepted it (or set off to the pickup) compensates THAT
 * runner, so it is credited to their withdrawable wallet — once, inside the
 * cancel transaction — instead of the platform keeping it. They are told.
 */
class CancellationFeeToRunnerTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $type;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        Event::fake();
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 0]);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 10]);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function booking(string $status, string $method = 'gcash', string $paymentStatus = 'paid', ?string $runnerId = 'runner'): Booking
    {
        $booking = Booking::create([
            'booking_number' => 'EG-20261031-'.strtoupper(substr(md5($status.$method.$paymentStatus.microtime()), 0, 6)),
            'customer_id' => $this->customer->id, 'runner_id' => $runnerId === 'runner' ? $this->runner->id : $runnerId,
            'errand_type_id' => $this->type->id, 'status' => $status,
            'payment_method' => $method, 'payment_status' => $paymentStatus,
            'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0,
            'total_amount' => 115, 'runner_payout' => 100, 'is_transportation' => false,
        ]);
        if ($paymentStatus === 'paid') {
            Payment::create([
                'booking_id' => $booking->id, 'customer_id' => $this->customer->id, 'amount' => 115,
                'currency' => 'PHP', 'method' => $method, 'status' => 'completed', 'paid_at' => now(),
            ]);
        }

        return $booking;
    }

    private function cancel(Booking $booking)
    {
        return $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/cancel", ['reason' => 'Changed my mind']);
    }

    public function test_the_fee_goes_to_the_runner_who_accepted(): void
    {
        $booking = $this->booking('accepted');

        $this->cancel($booking)
            ->assertOk()
            ->assertJsonPath('cancellation.fee', 20)
            ->assertJsonPath('cancellation.refunded', 95)
            ->assertJsonPath('message', fn (string $m) => str_contains($m, '₱20.00 cancellation fee went to your runner'));

        $this->assertEquals(95.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertEquals(30.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->runner->id, 'type' => 'cancel_fee', 'reference_id' => $booking->id,
            'amount' => 20, 'balance_after' => 30, 'status' => 'completed',
        ]);
        $this->assertTrue(Notification::where('user_id', $this->runner->id)->where('title', 'Cancellation fee added')->exists());
    }

    public function test_heading_to_pickup_pays_the_runner_too(): void
    {
        $booking = $this->booking('heading_to_pickup', 'wallet');

        $this->cancel($booking)->assertOk();

        $this->assertEquals(30.0, (float) $this->runner->fresh()->wallet_balance);
    }

    public function test_the_fee_is_credited_once(): void
    {
        $booking = $this->booking('accepted');

        $this->cancel($booking)->assertOk();
        $this->cancel($booking);

        $this->assertSame(1, WalletTransaction::where('user_id', $this->runner->id)->where('type', 'cancel_fee')->count());
        $this->assertEquals(30.0, (float) $this->runner->fresh()->wallet_balance);
    }

    public function test_no_fee_no_credit_before_a_runner_accepted(): void
    {
        $booking = $this->booking('matched');

        $this->cancel($booking)->assertOk()->assertJsonPath('cancellation.fee', 0);

        $this->assertEquals(10.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertFalse(WalletTransaction::where('type', 'cancel_fee')->exists());
    }

    public function test_a_cash_errand_collected_nothing_so_pays_nothing(): void
    {
        $booking = $this->booking('accepted', 'cash', 'unpaid');

        $this->cancel($booking)->assertOk();

        $this->assertEquals(10.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertFalse(WalletTransaction::where('type', 'cancel_fee')->exists());
    }

    public function test_the_runners_wallet_ledger_lists_it(): void
    {
        $booking = $this->booking('accepted');
        $this->cancel($booking)->assertOk();

        $this->actingAs($this->runner)->getJson('/api/v1/wallet/transactions')
            ->assertOk()
            ->assertJsonPath('data.0.type', 'cancel_fee')
            ->assertJsonPath('data.0.display_description', 'ErrandGuy · Cancellation fee');
    }
}
