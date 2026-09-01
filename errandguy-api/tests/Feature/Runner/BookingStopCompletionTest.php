<?php

namespace Tests\Feature\Runner;

use App\Http\Controllers\Runner\RunnerErrandController;
use App\Models\Booking;
use App\Models\BookingStop;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * PATCH /runner/errand/{id}/stops/{stop} — the write side of
 * `booking_stops.completed_at`, a column that has existed (and been serialized
 * by BookingResource) since the multi-stop table was created but was never
 * written by anything.
 *
 * This is display/progress only: no status transition, no money. What has to
 * hold is the authorization mirror of the shopping checklist, and REPLAY
 * SAFETY — the mobile side rides this on the offline mutation queue.
 */
class BookingStopCompletionTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private Booking $booking;
    private BookingStop $stop;

    protected function setUp(): void
    {
        parent::setUp();

        $this->registerRouteIfMissing();

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        RunnerProfile::create([
            'user_id' => $this->runner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'preferred_types' => [],
            'acceptance_rate' => 100.00,
            'completion_rate' => 100.00,
            'total_errands' => 0,
            'total_earnings' => 0.00,
        ]);

        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'x', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);

        $this->booking = Booking::create([
            'booking_number' => 'EG-STOPS-1',
            'customer_id' => $this->customer->id,
            'runner_id' => $this->runner->id,
            'errand_type_id' => $type->id,
            'status' => 'in_transit',
            'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.9,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.5, 'dropoff_lng' => 121.0,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 40, 'total_amount' => 155, 'runner_payout' => 120, 'is_transportation' => false,
        ]);

        $this->stop = BookingStop::create([
            'booking_id' => $this->booking->id, 'sequence' => 1,
            'address' => 'Stop 1', 'lat' => 14.55, 'lng' => 120.95,
        ]);

        BookingStop::create([
            'booking_id' => $this->booking->id, 'sequence' => 2,
            'address' => 'Stop 2', 'lat' => 14.54, 'lng' => 120.96,
        ]);
    }

    /**
     * The canonical registration belongs in routes/api.php, inside the
     * Route::prefix('runner')->middleware(['role:runner']) group:
     *
     *   Route::patch('/errand/{id}/stops/{stop}', [RunnerErrandController::class, 'completeStop']);
     *
     * Until that line lands, register an identical one here — same URI, same
     * auth + active + role middleware stack — so the endpoint is exercised
     * end-to-end rather than by calling the controller directly. Once the real
     * route exists this is a no-op and the tests hit it instead.
     */
    private function registerRouteIfMissing(): void
    {
        foreach (Route::getRoutes() as $route) {
            if ($route->uri() === 'api/v1/runner/errand/{id}/stops/{stop}') {
                return;
            }
        }

        Route::middleware(['api', 'auth:sanctum', 'active', 'role:runner'])
            ->prefix('api/v1/runner')
            ->patch('/errand/{id}/stops/{stop}', [RunnerErrandController::class, 'completeStop']);
    }

    private function url(?string $stopId = null): string
    {
        return "/api/v1/runner/errand/{$this->booking->id}/stops/" . ($stopId ?? $this->stop->id);
    }

    // ── the happy path ──────────────────────────────────────────────────

    public function test_the_assigned_runner_can_tick_a_stop_off(): void
    {
        $response = $this->actingAs($this->runner)->patchJson($this->url());

        $response->assertOk()->assertJsonPath('message', 'Stop marked complete.');

        $this->assertNotNull($this->stop->fresh()->completed_at);
    }

    /** The customer's screens read the tick off the booking payload. */
    public function test_the_response_carries_the_stops_with_completed_at(): void
    {
        $stops = $this->actingAs($this->runner)
            ->patchJson($this->url())
            ->assertOk()
            ->json('data.stops');

        $this->assertCount(2, $stops);
        $this->assertNotNull($stops[0]['completed_at']);
        $this->assertNull($stops[1]['completed_at']);
    }

    public function test_a_stop_can_be_reopened_after_a_mis_tap(): void
    {
        $this->actingAs($this->runner)->patchJson($this->url())->assertOk();

        $this->actingAs($this->runner)
            ->patchJson($this->url(), ['completed' => false])
            ->assertOk()
            ->assertJsonPath('message', 'Stop reopened.');

        $this->assertNull($this->stop->fresh()->completed_at);
    }

    // ── replay safety (the mutation queue re-sends) ─────────────────────

    public function test_replaying_the_same_tick_keeps_the_original_timestamp(): void
    {
        $this->actingAs($this->runner)->patchJson($this->url())->assertOk();
        $first = $this->stop->fresh()->completed_at;

        $this->travel(2)->minutes();

        $this->actingAs($this->runner)->patchJson($this->url())->assertOk();

        $this->assertTrue($first->equalTo($this->stop->fresh()->completed_at));
    }

    public function test_a_replay_does_not_mint_a_second_notification(): void
    {
        $this->actingAs($this->runner)->patchJson($this->url())->assertOk();

        $this->assertSame(1, $this->stopNotifications());

        // The app instance is shared across requests inside one test method
        // and Application::terminate() never clears its terminating callbacks,
        // so the FIRST request's dispatch(...)->afterResponse() job re-fires on
        // every later request here. That is a test-harness artifact (each real
        // request gets a fresh app), and it would mask the thing under test —
        // drop the already-run callbacks so the count below reflects only what
        // the replay itself queued.
        $this->forgetAfterResponseJobs();

        $this->actingAs($this->runner)->patchJson($this->url())->assertOk();

        $this->assertSame(1, $this->stopNotifications());
    }

    private function stopNotifications(): int
    {
        return Notification::where('user_id', $this->customer->id)
            ->where('title', 'Stop updated')
            ->count();
    }

    private function forgetAfterResponseJobs(): void
    {
        (function () {
            $this->terminatingCallbacks = [];
        })->call($this->app);
    }

    public function test_the_customer_is_notified_in_app_when_a_stop_lands(): void
    {
        $this->actingAs($this->runner)->patchJson($this->url())->assertOk();

        $notification = Notification::where('user_id', $this->customer->id)
            ->where('title', 'Stop updated')
            ->first();

        $this->assertNotNull($notification);
        $this->assertSame('booking_stops_updated', $notification->data['type']);
        $this->assertSame($this->booking->id, $notification->data['booking_id']);
        $this->assertCount(2, $notification->data['stops']);
    }

    // ── gating ──────────────────────────────────────────────────────────

    public function test_a_runner_who_is_not_assigned_is_refused(): void
    {
        $other = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $other->id, 'verification_status' => 'approved', 'is_online' => true,
            'preferred_types' => [], 'acceptance_rate' => 100.00, 'completion_rate' => 100.00,
            'total_errands' => 0, 'total_earnings' => 0.00,
        ]);

        $this->actingAs($other)->patchJson($this->url())->assertForbidden();

        $this->assertNull($this->stop->fresh()->completed_at);
    }

    public function test_the_customer_cannot_tick_their_own_stops(): void
    {
        // role:runner keeps the customer out of the runner group entirely.
        $this->actingAs($this->customer)->patchJson($this->url())->assertForbidden();

        $this->assertNull($this->stop->fresh()->completed_at);
    }

    public function test_it_requires_authentication(): void
    {
        $this->patchJson($this->url())->assertUnauthorized();
    }

    public function test_a_closed_booking_freezes_its_stops(): void
    {
        foreach (['completed', 'cancelled'] as $status) {
            $this->booking->update(['status' => $status]);

            $this->actingAs($this->runner)
                ->patchJson($this->url())
                ->assertStatus(422)
                ->assertJsonPath('code', 'BOOKING_STATE_INVALID');

            $this->assertNull($this->stop->fresh()->completed_at);
        }
    }

    public function test_a_stop_belonging_to_another_booking_is_a_404(): void
    {
        $otherBooking = Booking::create([
            'booking_number' => 'EG-STOPS-2',
            'customer_id' => $this->customer->id,
            'runner_id' => $this->runner->id,
            'errand_type_id' => $this->booking->errand_type_id,
            'status' => 'in_transit',
            'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.9,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.5, 'dropoff_lng' => 121.0,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ]);
        $foreign = BookingStop::create([
            'booking_id' => $otherBooking->id, 'sequence' => 1,
            'address' => 'Elsewhere', 'lat' => 14.4, 'lng' => 121.1,
        ]);

        $this->actingAs($this->runner)->patchJson($this->url($foreign->id))->assertNotFound();

        $this->assertNull($foreign->fresh()->completed_at);
    }

    public function test_a_non_boolean_completed_flag_is_rejected(): void
    {
        $this->actingAs($this->runner)
            ->patchJson($this->url(), ['completed' => 'sure'])
            ->assertStatus(422);

        $this->assertNull($this->stop->fresh()->completed_at);
    }

    /** Ticking a stop must not nudge the booking's own status machine. */
    public function test_it_does_not_touch_the_booking_status(): void
    {
        $this->actingAs($this->runner)->patchJson($this->url())->assertOk();

        $this->assertSame('in_transit', $this->booking->fresh()->status);
        $this->assertDatabaseCount('booking_status_logs', 0);
    }
}
