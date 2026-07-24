<?php

namespace Tests\Feature\Audit;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Review;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Reviews are bidirectional: the customer rates the runner AND the runner
 * rates the customer, so a completed booking can hold two rows keyed by
 * reviewer_id. The old Booking::review() hasOne was unordered, so once both
 * parties had rated, BookingResource served an arbitrary row — a customer (or
 * a runner viewing their history) could be shown the counter-party's review.
 *
 * These guards prove the serialized payload is now deterministic by role.
 */
class ReviewRelationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
    }

    private function errandType(): ErrandType
    {
        return ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'x',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function completedBooking(User $customer, User $runner): Booking
    {
        return Booking::create([
            'booking_number' => 'EG-20260401-REV', 'customer_id' => $customer->id, 'runner_id' => $runner->id,
            'errand_type_id' => $this->errandType()->id, 'status' => 'completed',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => 'cash', 'payment_status' => 'paid', 'is_transportation' => false,
            'completed_at' => now(),
        ]);
    }

    public function test_show_serializes_the_customers_review_deterministically_when_both_parties_rated(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $booking = $this->completedBooking($customer, $runner);

        // Insert the RUNNER's review FIRST (lower id). The old unordered hasOne
        // would have surfaced this one as `review`, so this ordering is the
        // regression guard: `review` must still resolve to the customer's row.
        Review::create([
            'booking_id' => $booking->id, 'reviewer_id' => $runner->id, 'reviewee_id' => $customer->id,
            'rating' => 2, 'comment' => 'runner rating the customer',
        ]);
        Review::create([
            'booking_id' => $booking->id, 'reviewer_id' => $customer->id, 'reviewee_id' => $runner->id,
            'rating' => 5, 'comment' => 'customer rating the runner',
        ]);

        $data = $this->actingAs($customer)
            ->getJson("/api/v1/bookings/{$booking->id}")
            ->assertOk()
            ->json('data');

        // Legacy `review` == the customer's rating of the runner (deterministic).
        $this->assertSame(5, $data['review']['rating']);
        $this->assertSame('customer rating the runner', $data['review']['comment']);

        // Role-keyed fields are unambiguous.
        $this->assertSame(5, $data['customer_review']['rating']);
        $this->assertSame(2, $data['runner_review']['rating']);

        // Full list carries both rows.
        $this->assertCount(2, $data['reviews']);
    }

    public function test_show_omits_review_fields_when_no_one_has_rated(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $booking = $this->completedBooking($customer, $runner);

        $data = $this->actingAs($customer)
            ->getJson("/api/v1/bookings/{$booking->id}")
            ->assertOk()
            ->json('data');

        // The relation is loaded (empty), so `reviews` is present-but-empty and
        // the role-keyed shortcuts are omitted (no false review shown).
        $this->assertSame([], $data['reviews']);
        $this->assertArrayNotHasKey('review', $data);
        $this->assertArrayNotHasKey('customer_review', $data);
        $this->assertArrayNotHasKey('runner_review', $data);
    }

    public function test_show_exposes_only_the_runner_review_when_only_the_runner_rated(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $booking = $this->completedBooking($customer, $runner);

        Review::create([
            'booking_id' => $booking->id, 'reviewer_id' => $runner->id, 'reviewee_id' => $customer->id,
            'rating' => 3, 'comment' => 'only the runner rated',
        ]);

        $data = $this->actingAs($customer)
            ->getJson("/api/v1/bookings/{$booking->id}")
            ->assertOk()
            ->json('data');

        // The customer hasn't rated, so `review`/`customer_review` are absent —
        // the runner's review must never masquerade as the customer's.
        $this->assertArrayNotHasKey('review', $data);
        $this->assertArrayNotHasKey('customer_review', $data);
        $this->assertSame(3, $data['runner_review']['rating']);
        $this->assertCount(1, $data['reviews']);
    }
}
