<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class EarningsHistoryTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'preferred_types' => [], 'acceptance_rate' => 100.00, 'completion_rate' => 100.00,
            'total_errands' => 0, 'total_earnings' => 0.00,
        ]);
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function completedBooking(string $number, $completedAt): Booking
    {
        return Booking::create([
            'booking_number' => $number,
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'completed',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 121.00,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 100,
            'is_transportation' => false, 'completed_at' => $completedAt,
        ]);
    }

    public function test_history_period_today_uses_the_business_day_window(): void
    {
        // "Today" is a Manila day (config('app.business_timezone')), not a UTC
        // one — the boundaries are pinned in BusinessTimezoneWindowsTest.
        $tz = config('app.business_timezone', 'Asia/Manila');

        $today = $this->completedBooking('EG-HIST-TODAY', now());
        // One hour before the local start of today → belongs to "yesterday".
        $yesterday = $this->completedBooking('EG-HIST-YEST', now($tz)->startOfDay()->utc()->subHour());

        $res = $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/earnings/history?period=today')
            ->assertOk();

        $ids = collect($res->json('data'))->pluck('id')->all();
        $this->assertContains($today->id, $ids);
        $this->assertNotContains($yesterday->id, $ids);
    }

    public function test_history_without_period_returns_all_rows(): void
    {
        $recent = $this->completedBooking('EG-HIST-A', now());
        $old = $this->completedBooking('EG-HIST-B', now()->subDays(40));

        $res = $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/earnings/history')
            ->assertOk();

        $ids = collect($res->json('data'))->pluck('id')->all();
        $this->assertContains($recent->id, $ids);
        $this->assertContains($old->id, $ids);
    }
}
