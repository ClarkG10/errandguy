<?php

namespace Tests\Feature\Notification;

use App\Jobs\AutoCancelBookingJob;
use App\Jobs\MatchRunnerJob;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\Payment;
use App\Models\User;
use App\Services\BookingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Every cancellation tells the customer WHY and what happened to their money
 * — "Your errand #EG-… was cancelled: no runner was available. ₱115.00 was
 * returned to your ErrandGuy wallet." — on every path: the customer's own
 * cancel, staff, no runner (auto-cancel), and an unpaid GCash/Maya payment.
 */
class CancellationNoticeTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    private ErrandType $type;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 0]);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function booking(string $method, string $paymentStatus, array $extra = []): Booking
    {
        $booking = Booking::create(array_merge([
            'booking_number' => 'EG-20261031-'.strtoupper(substr(md5(uniqid('', true)), 0, 5)),
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->type->id, 'status' => 'pending',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => $method, 'payment_status' => $paymentStatus,
            'is_transportation' => false,
        ], $extra));

        if ($paymentStatus === 'paid') {
            Payment::create([
                'booking_id' => $booking->id, 'customer_id' => $this->customer->id,
                'amount' => 115, 'method' => $method, 'status' => 'completed', 'paid_at' => now(),
            ]);
        }

        return $booking;
    }

    /** @return array<int, string> the customer's cancellation notices */
    private function customerNotices(): array
    {
        return Notification::where('user_id', $this->customer->id)
            ->where('title', 'Errand cancelled')
            ->pluck('body')
            ->all();
    }

    public function test_the_customers_own_cancel_says_where_the_money_went(): void
    {
        $booking = $this->booking('wallet', 'paid');

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/cancel", ['reason' => 'Changed my mind'])
            ->assertOk();

        $this->assertSame(
            ["You cancelled errand #{$booking->booking_number}. ₱115.00 was returned to your ErrandGuy wallet."],
            $this->customerNotices(),
        );
    }

    public function test_a_cash_errand_cancel_says_nothing_was_charged(): void
    {
        $booking = $this->booking('cash', 'unpaid');

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/cancel", ['reason' => 'Changed my mind'])
            ->assertOk();

        $this->assertSame(["You cancelled errand #{$booking->booking_number}. You weren’t charged."], $this->customerNotices());
    }

    public function test_a_staff_cancel_gives_the_reason_and_the_refund(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $booking = $this->booking('wallet', 'paid', ['status' => 'accepted', 'runner_id' => $runner->id]);
        $admin = AdminUser::create([
            'email' => 'ops@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops', 'role' => AdminUser::ROLE_OPS, 'is_active' => true,
        ]);

        app(BookingService::class)->adminCancel($booking->id, $admin->id, 'The shop is closed today');

        $this->assertSame(
            ["Your errand #{$booking->booking_number} was cancelled by ErrandGuy support: The shop is closed today. ₱115.00 was returned to your ErrandGuy wallet."],
            $this->customerNotices(),
        );
        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
        // The runner's notice stays cause-neutral.
        $this->assertDatabaseHas('notifications', [
            'user_id' => $runner->id,
            'body' => "Errand #{$booking->booking_number} has been cancelled.",
        ]);
    }

    public function test_an_auto_cancel_for_no_runner_sends_one_notice_with_the_refund(): void
    {
        Bus::fake([MatchRunnerJob::class]);
        $booking = $this->booking('wallet', 'paid', ['matching_started_at' => now()->subHours(3)]);
        $booking->forceFill(['created_at' => now()->subHours(3)])->save();

        $this->assertTrue((new AutoCancelBookingJob($booking->id))->handle());

        $this->assertSame(
            ["Your errand #{$booking->booking_number} was cancelled: no runner was available. ₱115.00 was returned to your ErrandGuy wallet."],
            $this->customerNotices(),
        );
        // One notice, not a cancel plus a separate "Refund issued".
        $this->assertSame(0, Notification::where('user_id', $this->customer->id)->where('title', 'Refund issued')->count());
        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_a_search_that_already_ended_in_no_runner_is_not_pushed_a_second_time(): void
    {
        \App\Models\DeviceToken::create(['user_id' => $this->customer->id, 'token' => 'ExponentPushToken[cust]']);
        \Illuminate\Support\Facades\Http::fake(['exp.host/*' => \Illuminate\Support\Facades\Http::response(['data' => [['status' => 'ok']]], 200)]);
        $booking = $this->booking('wallet', 'paid');

        // The search ends: one push, "No runner available" with the refund.
        MatchRunnerJob::dispatchSync($booking->id);
        $this->assertSame('no_runner', $booking->fresh()->status);

        // ~28 minutes later the matching deadline cancels it.
        $booking->forceFill(['matching_started_at' => now()->subHours(3), 'created_at' => now()->subHours(3)])->save();
        $this->assertTrue((new AutoCancelBookingJob($booking->id))->handle());
        $this->assertSame('cancelled', $booking->fresh()->status);

        $pushedTitles = collect(\Illuminate\Support\Facades\Http::recorded())
            ->map(fn ($pair) => $pair[0]->data()['title'] ?? null)
            ->filter()->values()->all();
        $this->assertSame(['No runner available'], $pushedTitles);

        // The push carries its inbox row, so tapping it can mark the row read.
        $pushed = \Illuminate\Support\Facades\Http::recorded()[0][0]->data()['data'];
        $this->assertSame(
            (string) Notification::where('user_id', $this->customer->id)->where('title', 'No runner available')->value('id'),
            $pushed['notification_id'],
        );

        // The cancel is still on record, but it doesn't buzz or add to the badge.
        $row = Notification::where('user_id', $this->customer->id)->where('title', 'Errand cancelled')->firstOrFail();
        $this->assertTrue((bool) $row->is_read);
    }

    public function test_an_unmatched_errand_says_where_its_refund_went(): void
    {
        $booking = $this->booking('wallet', 'paid');

        MatchRunnerJob::dispatchSync($booking->id);

        $this->assertSame('no_runner', $booking->fresh()->status);
        $this->assertSame('refunded', $booking->fresh()->payment_status);
        // The (queued) notice runs either side of the refund, so it says
        // "was returned" or "is being returned" — the where is always named.
        $body = (string) Notification::where('user_id', $this->customer->id)->where('title', 'No runner available')->value('body');
        $this->assertStringContainsString('₱115.00', $body);
        $this->assertStringContainsString('returned to your ErrandGuy wallet.', $body);
    }

    public function test_an_unmatched_errand_whose_money_went_back_points_to_booking_again(): void
    {
        $booking = $this->booking('wallet', 'paid');

        MatchRunnerJob::dispatchSync($booking->id);

        // Its money is back in the wallet, so "try again" would be refused —
        // the customer is told to book it again instead.
        $body = (string) Notification::where('user_id', $this->customer->id)->where('title', 'No runner available')->value('body');
        $this->assertStringEndsWith('returned to your ErrandGuy wallet. Tap to book it again.', $body);
        $this->assertStringNotContainsString('try again', $body);
    }

    public function test_an_unmatched_cash_errand_can_simply_be_tried_again(): void
    {
        $booking = $this->booking('cash', 'unpaid');

        MatchRunnerJob::dispatchSync($booking->id);

        $this->assertSame('no_runner', $booking->fresh()->status);
        $this->assertSame(
            "We couldn’t find a runner for errand #{$booking->booking_number}. You weren’t charged. Tap to try again.",
            Notification::where('user_id', $this->customer->id)->where('title', 'No runner available')->value('body'),
        );
    }

    public function test_an_unpaid_gcash_errand_says_it_was_not_charged(): void
    {
        $booking = $this->booking('gcash', 'pending');

        $this->travel(BookingService::PAYMENT_WINDOW_MINUTES + 1)->minutes();
        $this->assertTrue(app(BookingService::class)->cancelAbandonedPayment($booking->id));

        $this->assertSame(
            ["Your errand #{$booking->booking_number} was cancelled: the payment wasn't completed. You weren’t charged."],
            $this->customerNotices(),
        );
    }
}
