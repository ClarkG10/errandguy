<?php

namespace Tests\Feature\Notification;

use App\Events\BookingCreated;
use App\Listeners\SendBookingCreatedNotification;
use App\Models\Booking;
use App\Models\DeviceToken;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The booking-confirmation notice.
 *
 * Two things were wrong. The title said "Booking Confirmed" — Title Case, and
 * naming the object a "booking" when its own body called it an errand, in the
 * VERY FIRST push a new customer ever receives. And it woke the device
 * unconditionally: for a `now` errand that buzzes someone who tapped Confirm
 * one second earlier and is watching the tracking screen say the same thing,
 * immediately before the 'accepted' push that actually matters.
 *
 * A SCHEDULED errand is the opposite case and still pushes: it can be days
 * out, the customer has every reason to have closed the app, and the notice is
 * the receipt they keep — so it must also state WHEN, because "finding you a
 * runner" is a lie until scheduled_at−15min.
 */
class BookingCreatedNoticeTest extends TestCase
{
    use RefreshDatabase;

    private function makeCustomerWithDevice(): User
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        DeviceToken::create([
            'user_id' => $customer->id,
            'token' => 'ExponentPushToken[test-device]',
            'platform' => 'android',
        ]);

        return $customer;
    }

    private function makeBooking(User $customer, array $overrides = []): Booking
    {
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'D',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
            'is_active' => true, 'sort_order' => 1,
        ]);

        return Booking::create(array_merge([
            'booking_number' => 'EG-C-'.uniqid(),
            'customer_id' => $customer->id,
            'errand_type_id' => $type->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false, 'status' => 'pending',
        ], $overrides));
    }

    public function test_an_immediate_errand_is_confirmed_in_app_without_waking_the_device(): void
    {
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]], 200)]);

        $customer = $this->makeCustomerWithDevice();
        $booking = $this->makeBooking($customer);

        app(SendBookingCreatedNotification::class)->handle(new BookingCreated($booking));

        // The row and its Reverb broadcast still happen — nothing is lost from
        // the Alerts inbox, only the interruption.
        $notification = Notification::where('user_id', $customer->id)->firstOrFail();
        $this->assertSame('Errand booked', $notification->title);
        $this->assertStringContainsString('finding you a runner', $notification->body);

        // The device has a registered token, so a push WOULD have gone out.
        Http::assertNothingSent();
    }

    public function test_a_scheduled_errand_pushes_and_names_the_time_it_is_set_for(): void
    {
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]], 200)]);

        $customer = $this->makeCustomerWithDevice();
        $booking = $this->makeBooking($customer, [
            'schedule_type' => 'scheduled',
            // 09:30 Manila, expressed in UTC as it is stored.
            'scheduled_at' => now()->addDays(2)->setTimezone('UTC')->setTime(1, 30),
        ]);

        app(SendBookingCreatedNotification::class)->handle(new BookingCreated($booking));

        $notification = Notification::where('user_id', $customer->id)->firstOrFail();
        $this->assertSame('Errand booked', $notification->title);

        // Rendered in the BUSINESS timezone, not UTC — 01:30 UTC is 9:30 AM in
        // Manila, and telling a customer their errand is set for 1:30 AM is
        // exactly the class of bug config('app.business_timezone') exists for.
        $this->assertStringContainsString('9:30 AM', $notification->body);
        $this->assertStringNotContainsString('finding you a runner', $notification->body);

        Http::assertSent(fn ($request) => str_contains($request->url(), 'exp.host'));
    }

    /**
     * A scheduled booking with no `scheduled_at` is malformed, but it must not
     * throw inside a queued listener (and must not claim a time it doesn't
     * have) — it falls back to the quiet immediate notice.
     */
    public function test_a_scheduled_errand_without_a_time_falls_back_safely(): void
    {
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]], 200)]);

        $customer = $this->makeCustomerWithDevice();
        $booking = $this->makeBooking($customer, [
            'schedule_type' => 'scheduled',
            'scheduled_at' => null,
        ]);

        app(SendBookingCreatedNotification::class)->handle(new BookingCreated($booking));

        $this->assertSame(
            'Errand booked',
            Notification::where('user_id', $customer->id)->value('title'),
        );
        Http::assertNothingSent();
    }
}
