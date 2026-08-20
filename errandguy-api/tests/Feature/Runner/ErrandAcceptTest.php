<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

class ErrandAcceptTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private RunnerProfile $profile;
    private ErrandType $errandType;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $this->profile = RunnerProfile::create([
            'user_id' => $this->runner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'current_lat' => 14.5995,
            'current_lng' => 120.9842,
            'preferred_types' => [],
            'acceptance_rate' => 100.00,
            'completion_rate' => 100.00,
            'total_errands' => 0,
            'total_earnings' => 0.00,
        ]);

        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        $this->booking = Booking::create([
            'booking_number' => 'EG-20260331-ACPT',
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->errandType->id,
            'status' => 'pending',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);
    }

    public function test_runner_can_accept_pending_booking(): void
    {
        Event::fake();

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept");

        $response->assertOk()
            ->assertJsonPath('data.status', 'accepted');

        $this->booking->refresh();
        $this->assertEquals('accepted', $this->booking->status);
        $this->assertEquals($this->runner->id, $this->booking->runner_id);
        $this->assertNotNull($this->booking->accepted_at);
    }

    public function test_runner_can_accept_matched_booking(): void
    {
        Event::fake();
        $this->booking->update(['status' => 'matched']);

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept");

        $response->assertOk()
            ->assertJsonPath('data.status', 'accepted');
    }

    public function test_runner_cannot_accept_already_accepted_booking(): void
    {
        $this->booking->update(['status' => 'accepted', 'runner_id' => $this->runner->id]);

        $otherRunner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $otherRunner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'preferred_types' => [],
        ]);

        $response = $this->actingAs($otherRunner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept");

        // A booking taken/moved out from under the runner is a stale-view
        // conflict (409 BOOKING_STALE), not a validation error.
        $response->assertStatus(409)
            ->assertJsonPath('code', 'BOOKING_STALE');
        $this->assertStringContainsString('no longer available', (string) $response->json('message'));
    }

    public function test_runner_with_active_errand_cannot_accept_another(): void
    {
        Event::fake();

        // Create an active booking for this runner
        Booking::create([
            'booking_number' => 'EG-20260331-ACT2',
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'accepted',
            'pickup_address' => '789 Pine', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '321 Elm', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 3.0, 'base_fee' => 50, 'distance_fee' => 30, 'service_fee' => 12,
            'surcharge' => 0, 'total_amount' => 92, 'runner_payout' => 68,
            'is_transportation' => false,
        ]);

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept");

        // Already having an active errand is a conflict (409 BOOKING_CONFLICT).
        $response->assertStatus(409)
            ->assertJsonPath('code', 'BOOKING_CONFLICT');
        $this->assertStringContainsString('already have an active errand', (string) $response->json('message'));
    }

    public function test_offline_runner_cannot_accept(): void
    {
        $this->profile->update(['is_online' => false]);

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept");

        $response->assertStatus(422)
            ->assertJsonPath('message', 'You must be online and approved to accept errands.');
    }

    public function test_acceptance_creates_status_log_and_notification(): void
    {
        // Let BookingStatusChanged fire (the customer notification now comes
        // from its listener, not a direct create); fake everything else.
        Event::fakeExcept([\App\Events\BookingStatusChanged::class]);

        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept");

        $this->assertDatabaseHas('booking_status_logs', [
            'booking_id' => $this->booking->id,
            'status' => 'accepted',
            'changed_by' => $this->runner->id,
        ]);

        $this->assertDatabaseHas('notifications', [
            'user_id' => $this->customer->id,
            'type' => 'booking_update',
        ]);

        // Exactly ONE booking_update notification for the customer. This
        // regression-guards BOTH duplicate sources fixed together: the direct
        // Notification::create in the controller AND the double-registered
        // listener (event discovery + explicit Event::listen).
        $this->assertSame(
            1,
            \App\Models\Notification::where('user_id', $this->customer->id)
                ->where('type', 'booking_update')
                ->count(),
        );
    }

    public function test_runner_can_decline_booking(): void
    {
        $this->booking->update(['status' => 'matched', 'runner_id' => $this->runner->id]);

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/decline");

        $response->assertOk()
            ->assertJsonPath('message', 'Errand declined.');
    }

    public function test_runner_can_view_current_errand(): void
    {
        Event::fake();
        $this->booking->update(['status' => 'accepted', 'runner_id' => $this->runner->id]);

        $response = $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/errand/current');

        $response->assertOk()
            ->assertJsonPath('data.id', $this->booking->id);
    }

    public function test_current_returns_null_when_no_active_errand(): void
    {
        $response = $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/errand/current');

        $response->assertOk()
            ->assertJsonPath('data', null);
    }

    public function test_customer_cannot_accept_errand(): void
    {
        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept");

        $response->assertStatus(403);
    }

    public function test_runner_cannot_accept_their_own_booking_self_deal(): void
    {
        Event::fake();

        // The acting runner is ALSO the customer who booked this errand — the
        // exact self-deal a customer↔runner role-toggler could attempt: pay as
        // customer, collect the runner payout, self-review, farm stats. accept()
        // must refuse and leave the booking unclaimed.
        $selfBooking = Booking::create([
            'booking_number' => 'EG-20260331-SELF',
            'customer_id' => $this->runner->id, // same user as the acting runner
            'errand_type_id' => $this->errandType->id,
            'status' => 'pending',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'negotiate', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$selfBooking->id}/accept");

        $response->assertStatus(409)
            ->assertJsonPath('code', 'BOOKING_CONFLICT');
        $this->assertStringContainsString('your own errand', (string) $response->json('message'));

        // The booking stays unclaimed — no runner assigned, still pending.
        $selfBooking->refresh();
        $this->assertNull($selfBooking->runner_id);
        $this->assertSame('pending', $selfBooking->status);
    }

    public function test_available_offers_exclude_the_runners_own_booking(): void
    {
        // Two open negotiate bookings near the runner: one they booked
        // themselves, one from a real customer. The offer feed must show the
        // other customer's booking but NEVER the runner's own (defense-in-depth
        // for the self-deal guard).
        $mine = Booking::create([
            'booking_number' => 'EG-20260331-MINE',
            'customer_id' => $this->runner->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'pending',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'negotiate', 'vehicle_type_rate' => 'motorcycle',
            'negotiate_expires_at' => now()->addHour(),
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ]);
        $theirs = Booking::create([
            'booking_number' => 'EG-20260331-THRS',
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'pending',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'negotiate', 'vehicle_type_rate' => 'motorcycle',
            'negotiate_expires_at' => now()->addHour(),
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ]);

        $response = $this->actingAs($this->runner)->getJson('/api/v1/runner/errand/available');
        $response->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertContains($theirs->id, $ids, 'a real customer offer should appear');
        $this->assertNotContains($mine->id, $ids, 'the runner\'s own booking must never appear');
    }

    public function test_available_offers_gate_scheduled_negotiate_bookings_until_their_window(): void
    {
        // A scheduled negotiate booking is broadcast only at matchAt =
        // scheduled_at - 15min. The PULL feed must NOT surface one whose
        // scheduled time is still days out (else a runner could accept/lock a
        // prepaid booking early), but MUST surface one whose window has arrived
        // and an ordinary immediate booking.
        $base = [
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'pending',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'pricing_mode' => 'negotiate', 'vehicle_type_rate' => 'motorcycle',
            'negotiate_expires_at' => now()->addDays(3),
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ];

        $farFuture = Booking::create($base + [
            'booking_number' => 'EG-20260331-SCHF',
            'schedule_type' => 'scheduled', 'scheduled_at' => now()->addDays(3),
        ]);
        $windowOpen = Booking::create($base + [
            'booking_number' => 'EG-20260331-SCHN',
            'schedule_type' => 'scheduled', 'scheduled_at' => now()->addMinutes(5),
        ]);
        $immediate = Booking::create($base + [
            'booking_number' => 'EG-20260331-IMMD',
            'schedule_type' => 'now', 'scheduled_at' => null,
            'negotiate_expires_at' => now()->addHour(),
        ]);

        $response = $this->actingAs($this->runner)->getJson('/api/v1/runner/errand/available');
        $response->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertNotContains($farFuture->id, $ids, 'a scheduled booking days out must not be offered yet');
        $this->assertContains($windowOpen->id, $ids, 'a scheduled booking within 15min of its time should be offered');
        $this->assertContains($immediate->id, $ids, 'an immediate negotiate booking should be offered');
    }
}
