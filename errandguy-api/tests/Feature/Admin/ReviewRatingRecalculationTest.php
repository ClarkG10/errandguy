<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\Reviews\Pages\ListReviews;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Review;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * A person's average rating follows moderation: deleting a review or flagging
 * it takes it out of the average, unflagging puts it back.
 */
class ReviewRatingRecalculationTest extends TestCase
{
    use RefreshDatabase;

    private User $runner;
    private ErrandType $type;

    protected function setUp(): void
    {
        parent::setUp();

        $admin = AdminUser::create([
            'email' => 'super@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Super', 'role' => 'super_admin', 'is_active' => true,
        ]);
        $this->actingAs($admin, 'admin');

        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function review(int $rating): Review
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $booking = Booking::create([
            'booking_number' => 'EG-REV-'.substr(uniqid(), -6), 'customer_id' => $customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $this->type->id, 'status' => 'completed', 'pickup_address' => 'A', 'pickup_lat' => 14.6,
            'pickup_lng' => 120.98, 'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle', 'distance_km' => 5,
            'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0, 'total_amount' => 115,
            'runner_payout' => 85, 'is_transportation' => false,
        ]);

        return Review::create([
            'booking_id' => $booking->id, 'reviewer_id' => $customer->id, 'reviewee_id' => $this->runner->id,
            'rating' => $rating, 'comment' => 'ok',
        ]);
    }

    private function assertRating(float $avg, int $count): void
    {
        $runner = $this->runner->fresh();
        $this->assertEqualsWithDelta($avg, (float) $runner->avg_rating, 0.001);
        $this->assertSame($count, (int) $runner->total_ratings);
    }

    public function test_flagging_takes_a_review_out_of_the_average_and_unflagging_puts_it_back(): void
    {
        $this->review(5);
        $unfair = $this->review(1);
        $this->assertRating(3.0, 2);

        Livewire::test(ListReviews::class)->callTableAction('toggleFlag', $unfair);
        $this->assertTrue($unfair->fresh()->is_flagged);
        $this->assertRating(5.0, 1);

        Livewire::test(ListReviews::class)->callTableAction('toggleFlag', $unfair);
        $this->assertRating(3.0, 2);
    }

    public function test_deleting_a_review_recalculates_the_average(): void
    {
        $this->review(5);
        $this->review(4);
        $bad = $this->review(1);
        $this->assertRating(3.33, 3);

        Livewire::test(ListReviews::class)->callTableAction('delete', $bad);

        $this->assertNull(Review::find($bad->id));
        $this->assertRating(4.5, 2);
    }

    public function test_bulk_delete_and_bulk_unflag_recalculate_too(): void
    {
        $keep = $this->review(4);
        $a = $this->review(1);
        $b = $this->review(2);
        $a->update(['is_flagged' => true]);
        $this->assertRating(3.0, 2);

        Livewire::test(ListReviews::class)->callTableBulkAction('unflagSelected', [$a]);
        $this->assertRating(2.33, 3);

        Livewire::test(ListReviews::class)->callTableBulkAction('deleteSelected', [$a, $b]);
        $this->assertRating(4.0, 1);
        $this->assertNotNull($keep->fresh());
    }

    public function test_removing_the_last_review_resets_the_average(): void
    {
        $only = $this->review(2);
        $this->assertRating(2.0, 1);

        $only->delete();

        $this->assertRating(0.0, 0);
    }
}
