<?php

namespace Tests\Feature\Booking;

use App\Jobs\ExpireStaleMatchesJob;
use App\Jobs\MatchRunnerJob;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Tests\TestCase;

/**
 * Guards H12: a fixed-price booking whose matched runner never accepts must be
 * reset to 'pending' and re-matched (excluding that runner) rather than
 * stranding the customer on "Runner Found" forever.
 */
class StaleMatchReassignTest extends TestCase
{
    use RefreshDatabase;

    private function makeBooking(array $overrides): Booking
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'D',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
            'is_active' => true, 'sort_order' => 1,
        ]);

        return Booking::create(array_merge([
            'booking_number' => 'EG-S-'.uniqid(), // keep ≤ booking_number varchar(20)
            'customer_id' => $customer->id,
            'errand_type_id' => $type->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ], $overrides));
    }

    public function test_stale_matched_booking_is_reset_and_rematched(): void
    {
        Bus::fake([MatchRunnerJob::class]);
        $runner = User::factory()->create(['role' => 'runner']);
        $booking = $this->makeBooking([
            'status' => 'matched',
            'runner_id' => $runner->id,
            'matched_at' => now()->subMinutes(5), // well past the 90s timeout
        ]);

        (new ExpireStaleMatchesJob())->handle();

        $booking->refresh();
        $this->assertSame('pending', $booking->status);
        $this->assertNull($booking->runner_id);
        $this->assertNull($booking->matched_at);

        Bus::assertDispatched(MatchRunnerJob::class, function (MatchRunnerJob $job) use ($booking, $runner) {
            return $job->bookingId === $booking->id && $job->excludeUserId === $runner->id;
        });
    }

    public function test_recently_matched_booking_is_left_alone(): void
    {
        Bus::fake([MatchRunnerJob::class]);
        $runner = User::factory()->create(['role' => 'runner']);
        $booking = $this->makeBooking([
            'status' => 'matched',
            'runner_id' => $runner->id,
            'matched_at' => now()->subSeconds(10), // still within the window
        ]);

        (new ExpireStaleMatchesJob())->handle();

        $this->assertSame('matched', $booking->fresh()->status);
        Bus::assertNotDispatched(MatchRunnerJob::class);
    }

    public function test_accepted_booking_is_not_touched(): void
    {
        Bus::fake([MatchRunnerJob::class]);
        $runner = User::factory()->create(['role' => 'runner']);
        $booking = $this->makeBooking([
            'status' => 'accepted',
            'runner_id' => $runner->id,
            'matched_at' => now()->subMinutes(10),
        ]);

        (new ExpireStaleMatchesJob())->handle();

        $this->assertSame('accepted', $booking->fresh()->status);
        Bus::assertNotDispatched(MatchRunnerJob::class);
    }
}
