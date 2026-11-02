<?php

namespace Tests\Feature\Notification;

use App\Events\BookingStatusChanged;
use App\Listeners\SendBookingStatusNotification;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * "Buy for me": the runner pays for the items out of pocket and the customer
 * repays them in cash at the door. When the runner has bought them and when
 * they arrive, the customer is told the amount to have ready — what the runner
 * reported paying, or, before they have, "up to" the budget the customer set.
 * Errands of the retired food / grocery types (merged into "Buy for me") get
 * the same notice; other types keep their usual copy.
 */
class BuyForMeItemCashNoticeTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]], 200)]);
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
    }

    private function booking(string $slug, array $extra = []): Booking
    {
        $type = ErrandType::firstOrCreate(['slug' => $slug], [
            'name' => ucfirst($slug), 'description' => 'x', 'icon_name' => 'Cart', 'base_fee' => 50,
            'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10, 'per_km_car' => 18,
            'is_active' => true, 'sort_order' => 1,
        ]);

        return Booking::create(array_merge([
            'booking_number' => 'EG-BFM-'.strtoupper(substr(md5(uniqid('', true)), 0, 6)),
            'customer_id' => $this->customer->id,
            'runner_id' => User::factory()->create(['role' => 'runner', 'status' => 'active'])->id,
            'errand_type_id' => $type->id, 'status' => 'picked_up',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => 'cash', 'payment_status' => 'unpaid', 'is_transportation' => false,
        ], $extra));
    }

    /** @return array{0: ?string, 1: ?string} title and body of the customer's notice */
    private function notice(Booking $booking, string $status): array
    {
        app(SendBookingStatusNotification::class)->handle(new BookingStatusChanged($booking, 'accepted', $status));

        $row = Notification::where('user_id', $this->customer->id)->latest('created_at')->first();

        return [$row?->title, $row?->body];
    }

    public function test_the_runner_reported_cost_is_the_cash_to_have_ready(): void
    {
        $booking = $this->booking('purchase', ['shopping_budget' => 500, 'actual_item_cost' => 450]);

        $this->assertSame(
            ['Items bought', 'Your runner paid ₱450.00 for your items — please have ₱450.00 cash ready.'],
            $this->notice($booking, 'picked_up'),
        );
        $this->assertSame(
            ['Arrived at drop-off', 'Your runner has arrived. Your runner paid ₱450.00 for your items — please have ₱450.00 cash ready.'],
            $this->notice($booking, 'arrived_at_dropoff'),
        );
    }

    public function test_before_a_cost_is_reported_the_budget_is_the_ceiling(): void
    {
        $booking = $this->booking('purchase', ['shopping_budget' => 1200]);

        $this->assertSame(
            'Your runner paid up to ₱1,200.00 for your items — please have up to ₱1,200.00 cash ready.',
            $this->notice($booking, 'picked_up')[1],
        );
    }

    public function test_the_retired_food_and_grocery_types_get_the_same_notice(): void
    {
        foreach (['food', 'grocery'] as $slug) {
            $booking = $this->booking($slug, ['actual_item_cost' => 300]);

            $this->assertSame(
                'Your runner paid ₱300.00 for your items — please have ₱300.00 cash ready.',
                $this->notice($booking, 'picked_up')[1],
                $slug,
            );
        }

        // An old errand with neither a cost nor a budget still says what to do.
        $this->assertSame(
            'Your runner paid for your items — please have the cash ready to repay them.',
            $this->notice($this->booking('grocery'), 'picked_up')[1],
        );
    }

    public function test_a_delivery_keeps_its_usual_copy(): void
    {
        $booking = $this->booking('delivery', ['actual_item_cost' => 300]);

        $this->assertSame(['Item picked up', 'Your item has been picked up and is on the way.'], $this->notice($booking, 'picked_up'));
        $this->assertSame(['Arrived at drop-off', 'Your runner has arrived at the drop-off location.'], $this->notice($booking, 'arrived_at_dropoff'));
    }
}
