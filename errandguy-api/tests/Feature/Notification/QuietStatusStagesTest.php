<?php

namespace Tests\Feature\Notification;

use App\Events\BookingStatusChanged;
use App\Listeners\SendBookingStatusNotification;
use App\Models\Booking;
use App\Models\DeviceToken;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * A standard delivery walks nine templated stages and the runner taps through
 * each one, so the customer's phone used to buzz nine times for a single
 * errand — several saying the same thing seconds apart ('heading_to_pickup'
 * repeats 'accepted' almost verbatim; 'in_transit' repeats 'picked_up';
 * 'delivered' is chased by 'completed'). The alerts that matter, like the
 * runner arriving at the door, drowned in that noise.
 *
 * Quiet stages must still reach the app — persisted inbox row + Reverb
 * broadcast — while leaving the device alone.
 */
class QuietStatusStagesTest extends TestCase
{
    use RefreshDatabase;

    private function bookingWithParties(): Booking
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        DeviceToken::create(['user_id' => $customer->id, 'token' => 'ExponentPushToken[quiet-'.uniqid().']']);

        $type = ErrandType::firstOrCreate(['slug' => 'delivery'], [
            'name' => 'Delivery', 'description' => 'D',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18,
            'is_active' => true, 'sort_order' => 1,
        ]);

        return Booking::create([
            'booking_number' => 'EG-Q-'.uniqid(),
            'customer_id' => $customer->id,
            'runner_id' => $runner->id,
            'errand_type_id' => $type->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false, 'status' => 'accepted',
        ]);
    }

    private function fire(Booking $booking, string $status): void
    {
        app(SendBookingStatusNotification::class)
            ->handle(new BookingStatusChanged($booking, 'accepted', $status));
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function quietStatuses(): array
    {
        return [
            'heading_to_pickup (repeats accepted)' => ['heading_to_pickup'],
            'in_transit (repeats picked_up)' => ['in_transit'],
            'delivered (completed follows)' => ['delivered'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('quietStatuses')]
    public function test_quiet_stage_records_the_row_without_waking_the_device(string $status): void
    {
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]], 200)]);
        $booking = $this->bookingWithParties();

        $this->fire($booking, $status);

        Http::assertNothingSent();
        $this->assertSame(
            1,
            Notification::where('user_id', $booking->customer_id)->count(),
            "the {$status} stage must still land in the in-app inbox",
        );
        // Already read: progress nobody was interrupted for doesn't count
        // toward the unread badge.
        $this->assertSame(0, Notification::where('user_id', $booking->customer_id)->where('is_read', false)->count());
    }

    public function test_an_offer_is_not_announced_as_a_runner_found(): void
    {
        // 'matched' is only an offer the runner may decline; the customer hears
        // when a runner accepts. "Runner found" rows used to pile up before
        // "No runner available".
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]], 200)]);
        $booking = $this->bookingWithParties();
        $this->fire($booking, 'matched');
        Http::assertNothingSent();
        $this->assertSame(0, Notification::where('user_id', $booking->customer_id)->count());
    }

    public function test_completion_says_what_was_paid_and_what_the_runner_got(): void
    {
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]], 200)]);
        $notice = fn (Booking $b, string $userId) => Notification::where('user_id', $userId)->latest('created_at')->value('body');
        $ledger = fn (Booking $b, string $type, float $amount) => \App\Models\WalletTransaction::create([
            'user_id' => $b->runner_id, 'reference_id' => $b->id, 'type' => $type, 'amount' => $amount,
            'balance_after' => 0, 'status' => 'completed', 'description' => 'x',
        ]);

        // Paid by GCash: the runner's ₱85 went to their wallet.
        $paid = $this->bookingWithParties();
        $paid->update(['status' => 'completed', 'payment_method' => 'gcash', 'payment_status' => 'paid']);
        $ledger($paid, 'earning', 85);
        $this->fire($paid, 'completed');
        $this->assertSame("Your errand #{$paid->booking_number} has been completed. The fare was ₱115.00, paid by GCash.", $notice($paid, $paid->customer_id));
        $this->assertSame("Errand #{$paid->booking_number} completed. ₱85.00 was added to your ErrandGuy wallet.", $notice($paid, $paid->runner_id));

        // Cash: they keep the cash; the ₱30 fee came out of their wallet.
        $cash = $this->bookingWithParties();
        $cash->update(['status' => 'completed', 'payment_method' => 'cash', 'payment_status' => 'unpaid']);
        $ledger($cash, 'commission', -30);
        $this->fire($cash, 'completed');
        $this->assertSame("Your errand #{$cash->booking_number} has been completed. The fare was ₱115.00, paid in cash.", $notice($cash, $cash->customer_id));
        $this->assertSame("Errand #{$cash->booking_number} completed. You keep the fare you collected in cash; ErrandGuy’s ₱30.00 fee was taken from your wallet.", $notice($cash, $cash->runner_id));

        // An online payment that never came through: nothing credited yet, no fare claim.
        $unpaid = $this->bookingWithParties();
        $unpaid->update(['status' => 'completed', 'payment_method' => 'gcash', 'payment_status' => 'failed']);
        $this->fire($unpaid, 'completed');
        $this->assertSame("Your errand #{$unpaid->booking_number} has been completed.", $notice($unpaid, $unpaid->customer_id));
        $this->assertStringContainsString('your ₱85.00 is added to your wallet as soon as it does', $notice($unpaid, $unpaid->runner_id));
    }

    /**
     * The counterpart guard: an actionable stage must still buzz, or this
     * change would have made the app quieter by breaking it.
     */
    public function test_arrival_still_wakes_the_device(): void
    {
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]], 200)]);
        $booking = $this->bookingWithParties();

        $this->fire($booking, 'arrived_at_pickup');

        Http::assertSent(fn ($req) => str_contains($req->url(), 'exp.host'));
        $this->assertSame(1, Notification::where('user_id', $booking->customer_id)->count());
    }

    public function test_completion_still_wakes_the_device(): void
    {
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]], 200)]);
        $booking = $this->bookingWithParties();

        $this->fire($booking, 'completed');

        Http::assertSent(fn ($req) => str_contains($req->url(), 'exp.host'));
    }
}
