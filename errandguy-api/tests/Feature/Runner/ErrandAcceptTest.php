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
            'vehicle_type' => 'motorcycle',
            'current_lat' => 14.5995,
            'current_lng' => 120.9842,
            'preferred_types' => [],
            'completion_rate' => 100.00,
            'total_errands' => 0,
            'total_earnings' => 0.00,
        ]);

        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'is_active' => true, 'sort_order' => 1,
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

    /** Offer the setUp booking to the setUp runner, as MatchRunnerJob does. */
    private function offerToRunner(): void
    {
        $this->booking->update(['status' => 'matched', 'runner_id' => $this->runner->id, 'matched_at' => now()]);
    }

    public function test_runner_can_accept_the_errand_offered_to_them(): void
    {
        Event::fake();
        $this->offerToRunner();

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept");

        $response->assertOk()
            ->assertJsonPath('data.status', 'accepted');

        $this->booking->refresh();
        $this->assertEquals('accepted', $this->booking->status);
        $this->assertEquals($this->runner->id, $this->booking->runner_id);
        $this->assertNotNull($this->booking->accepted_at);
    }

    public function test_an_errand_that_was_not_offered_to_the_runner_cannot_be_accepted(): void
    {
        // There is no open list to pick errands from any more: a pending errand
        // (never offered to this runner, or an offer that already lapsed) is
        // not theirs to take.
        Event::fake();

        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept")
            ->assertStatus(409)
            ->assertJsonPath('code', 'BOOKING_STALE');

        $this->booking->refresh();
        $this->assertSame('pending', $this->booking->status);
        $this->assertNull($this->booking->runner_id);
    }

    public function test_an_offer_for_another_runner_cannot_be_accepted(): void
    {
        Event::fake();
        $other = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $this->booking->update(['status' => 'matched', 'runner_id' => $other->id, 'matched_at' => now()]);

        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept")
            ->assertStatus(409);

        $this->assertSame($other->id, $this->booking->fresh()->runner_id);
    }

    public function test_a_car_errand_cannot_be_accepted_on_a_motorcycle(): void
    {
        // The customer paid the car price. Matching never offers it to a
        // motorcycle, but a runner may have changed vehicle after the offer.
        Event::fake();
        $this->booking->update(['vehicle_type_rate' => 'car']);
        $this->offerToRunner();

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept")
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACCEPT_NOT_ALLOWED');

        $this->assertStringContainsString('needs a car', (string) $response->json('message'));
        $this->assertSame('matched', $this->booking->fresh()->status);
    }

    public function test_a_bigger_vehicle_can_accept_a_smaller_errand(): void
    {
        Event::fake();
        $this->profile->update(['vehicle_type' => 'car']);
        $this->booking->update(['vehicle_type_rate' => 'bicycle']);
        $this->offerToRunner();

        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/accept")
            ->assertOk();
    }

    public function test_the_offer_payload_carries_the_booked_vehicle(): void
    {
        Event::fake();
        $this->offerToRunner();

        $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/errand/current')
            ->assertOk()
            ->assertJsonPath('data.vehicle_type', 'motorcycle');

        $payload = (new \App\Events\IncomingRequest($this->booking->fresh()))->broadcastWith();
        $this->assertSame('motorcycle', $payload['vehicle_type']);
        foreach (['customer_offer', 'recommended_min', 'recommended_max', 'negotiate_expires_at'] as $retired) {
            $this->assertArrayNotHasKey($retired, $payload);
        }
    }

    public function test_the_open_offers_list_is_gone_and_answers_empty(): void
    {
        // Errands are offered one runner at a time; the app build already on
        // phones still polls the old list, so it gets an empty one — even
        // while an errand is offered to this very runner.
        $this->offerToRunner();

        $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/errand/available')
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data', []);
    }

    public function test_a_stale_decline_is_a_no_op_that_costs_the_runner_nothing(): void
    {
        // The offer already lapsed (back to pending, no runner) when the
        // runner tapped Decline: nothing to revert, and nothing held against them.
        $this->profile->update(['total_errands' => 4]);

        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/decline")
            ->assertOk();

        $this->assertSame('pending', $this->booking->fresh()->status);
        $this->assertSame(4, (int) $this->profile->fresh()->total_errands);
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
        $this->offerToRunner();

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
        $this->offerToRunner();

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
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);

        $response = $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$selfBooking->id}/accept");

        $response->assertStatus(409)
            ->assertJsonPath('code', 'ACCEPT_NOT_ALLOWED');
        $this->assertStringContainsString('your own errand', (string) $response->json('message'));

        // The booking stays unclaimed — no runner assigned, still pending.
        $selfBooking->refresh();
        $this->assertNull($selfBooking->runner_id);
        $this->assertSame('pending', $selfBooking->status);
    }
}
