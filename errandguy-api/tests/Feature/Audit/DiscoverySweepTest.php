<?php

namespace Tests\Feature\Audit;

use App\Jobs\MatchRunnerJob;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Regression guards for the discovery-sweep fixes (ride-PIN disclosure,
 * support-report ownership, decline re-match exclusion, single offer
 * notification, admin-cancel uuid).
 */
class DiscoverySweepTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $errandType;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'current_lat' => 14.60, 'current_lng' => 120.98, 'preferred_types' => [],
            'acceptance_rate' => 100.00, 'completion_rate' => 100.00, 'total_errands' => 0, 'total_earnings' => 0.00,
            'last_location_at' => now(),
        ]);

        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        $this->booking = Booking::create([
            'booking_number' => 'EG-20260331-DISC', 'customer_id' => $this->customer->id,
            'runner_id' => $this->runner->id, 'errand_type_id' => $this->errandType->id, 'status' => 'accepted',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => true, 'ride_pin' => '4821',
        ]);
    }

    public function test_ride_pin_is_hidden_from_the_runner_but_shown_to_the_customer(): void
    {
        // Runner (assigned) must NOT receive the PIN — they're supposed to get
        // it from the passenger and type it into verify-pin.
        $this->actingAs($this->runner)
            ->getJson("/api/v1/runner/errand/{$this->booking->id}")
            ->assertOk()
            ->assertJsonMissingPath('data.ride_pin');

        // Customer (the passenger who recites it) still sees it.
        $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$this->booking->id}")
            ->assertOk()
            ->assertJsonPath('data.ride_pin', '4821');
    }

    public function test_support_report_rejects_a_foreign_booking(): void
    {
        $stranger = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $foreign = Booking::create([
            'booking_number' => 'EG-20260331-FRGN', 'customer_id' => $stranger->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'pending',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ]);

        // Referencing a stranger's booking is rejected...
        $this->actingAs($this->customer)
            ->postJson('/api/v1/support/report', [
                'booking_id' => $foreign->id, 'subject' => 'x', 'description' => 'y', 'category' => 'other',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['booking_id']);

        // ...but the caller's own booking is accepted.
        $this->actingAs($this->customer)
            ->postJson('/api/v1/support/report', [
                'booking_id' => $this->booking->id, 'subject' => 'x', 'description' => 'y', 'category' => 'other',
            ])
            ->assertCreated();
    }

    public function test_decline_excludes_the_declining_runner_from_the_immediate_rematch(): void
    {
        Bus::fake([MatchRunnerJob::class]);
        $this->booking->update(['status' => 'matched']);

        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/decline")
            ->assertOk();

        Bus::assertDispatched(MatchRunnerJob::class, function (MatchRunnerJob $job) {
            return $job->bookingId === $this->booking->id && $job->excludeUserId === $this->runner->id;
        });
    }

    public function test_match_creates_a_single_offer_notification_for_the_runner(): void
    {
        Event::fake(); // isolate from BookingStatusChanged listeners
        // Free the runner — the setUp booking is 'accepted' (active), which
        // would make them ineligible for a new match.
        $this->booking->update(['status' => 'completed']);
        $pending = Booking::create([
            'booking_number' => 'EG-20260331-MTCH', 'customer_id' => $this->customer->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'pending',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ]);

        MatchRunnerJob::dispatchSync($pending->id);

        // Exactly one offer notification — not two (inline create was removed;
        // sendPush persists the single row).
        $this->assertEquals(
            1,
            Notification::where('user_id', $this->runner->id)
                ->where('title', 'New errand offer')->count(),
        );
    }

    public function test_admin_cancel_records_the_admin_id_not_a_literal_string(): void
    {
        $admin = AdminUser::create([
            'email' => 'ops@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops', 'role' => 'admin', 'is_active' => true,
        ]);
        Sanctum::actingAs($admin);

        $this->postJson("/api/v1/admin/bookings/{$this->booking->id}/cancel", ['reason' => 'fraud'])
            ->assertOk();

        // cancelled_by is a uuid column — it must hold the admin's id, never the
        // literal 'admin' (which 500'd on Postgres).
        $this->assertEquals($admin->id, $this->booking->fresh()->cancelled_by);
        $this->assertEquals('cancelled', $this->booking->fresh()->status);
    }
}
