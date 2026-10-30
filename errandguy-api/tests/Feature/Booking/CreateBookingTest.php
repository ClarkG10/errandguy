<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\ErrandType;
use App\Models\SystemConfig;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class CreateBookingTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $deliveryType;
    private array $validBookingData;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->customer = User::factory()->create([
            'role' => 'customer',
            'status' => 'active',
        ]);

        $this->deliveryType = ErrandType::create([
            'slug' => 'delivery',
            'name' => 'Delivery',
            'description' => 'Send or receive packages',
            'icon_name' => 'Package',
            'base_fee' => 50.00,
            'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00,
            'per_km_motorcycle' => 10.00,
            'per_km_car' => 18.00,
            'surcharge' => 0.00,
            'is_active' => true,
            'sort_order' => 1,
        ]);

        $this->validBookingData = [
            'errand_type_id' => $this->deliveryType->id,
            'pickup_address' => '123 Main St, Manila',
            'pickup_lat' => 14.5995,
            'pickup_lng' => 120.9842,
            'dropoff_address' => '456 Oak Ave, Makati',
            'dropoff_lat' => 14.5547,
            'dropoff_lng' => 121.0244,
            'description' => 'Please pick up a package',
            'schedule_type' => 'now',
            'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle',
            'payment_method' => 'cash',
        ];
    }

    public function test_customer_can_create_fixed_price_booking(): void
    {
        Bus::fake();

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->validBookingData);

        $response->assertStatus(201)
            ->assertJsonStructure([
                'data' => ['id', 'booking_number', 'status', 'pickup_address', 'dropoff_address', 'total_amount'],
                'message',
            ])
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.pickup_address', '123 Main St, Manila');

        $this->assertDatabaseHas('bookings', [
            'customer_id' => $this->customer->id,
            'status' => 'pending',
            'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle',
        ]);

        $booking = Booking::first();
        $this->assertDatabaseHas('booking_status_logs', [
            'booking_id' => $booking->id,
            'status' => 'pending',
            'changed_by' => $this->customer->id,
        ]);
    }

    public function test_booking_scheduled_beyond_30_days_is_rejected(): void
    {
        Bus::fake();

        // Regression: Carbon 3's diffInDays() is signed, so the old
        // `diffInDays(now()) > 30` guard never fired for future dates and
        // far-out bookings slipped through. A date >30 days out must 422.
        $data = array_merge($this->validBookingData, [
            'schedule_type' => 'scheduled',
            'scheduled_at' => now()->addDays(40)->toIso8601String(),
        ]);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data)
            ->assertStatus(422)
            ->assertJsonValidationErrors(['scheduled_at']);
    }

    public function test_booking_scheduled_within_30_days_is_accepted(): void
    {
        Bus::fake();

        $data = array_merge($this->validBookingData, [
            'schedule_type' => 'scheduled',
            'scheduled_at' => now()->addDays(10)->toIso8601String(),
        ]);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data)
            ->assertStatus(201);
    }

    public function test_booking_number_is_generated(): void
    {
        Bus::fake();

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->validBookingData);

        $response->assertStatus(201);

        $bookingNumber = $response->json('data.booking_number');
        $this->assertStringStartsWith('EG-', $bookingNumber);
        $this->assertMatchesRegularExpression('/^EG-\d{8}-[A-Z0-9]{6}$/', $bookingNumber);
    }

    public function test_pricing_is_calculated_correctly(): void
    {
        Bus::fake();

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->validBookingData);

        $response->assertStatus(201);

        $data = $response->json('data');
        $this->assertGreaterThan(0, (float) $data['base_fee']);
        $this->assertGreaterThanOrEqual(0, (float) $data['distance_fee']);
        $this->assertGreaterThan(0, (float) $data['service_fee']);
        $this->assertGreaterThan(0, (float) $data['total_amount']);
    }

    public function test_a_new_booking_is_never_a_passenger_ride(): void
    {
        Bus::fake();

        // Rides are retired: no new booking is flagged as one or carries a PIN.
        // is_transportation stays in the payload (always false) only because
        // the shipped app reads it; the PIN itself is no longer served.
        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->validBookingData);

        $response->assertStatus(201)
            ->assertJsonPath('data.is_transportation', false)
            ->assertJsonMissingPath('data.ride_pin');

        $booking = Booking::first();
        $this->assertNull($booking->ride_pin);
        $this->assertFalse($booking->is_transportation);
    }

    /**
     * The six types retired for launch stay in the table (switched off) so old
     * bookings still show their type — but none of them can be booked.
     */
    public function test_retired_errand_types_cannot_be_booked(): void
    {
        Bus::fake();

        foreach (['document', 'laundry', 'food', 'grocery', 'bills_payment', 'transportation'] as $i => $slug) {
            $retired = ErrandType::create([
                'slug' => $slug, 'name' => ucfirst($slug), 'description' => 'Retired',
                'icon_name' => 'X', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
                'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
                'is_active' => false, 'sort_order' => 10 + $i,
            ]);

            $this->actingAs($this->customer)
                ->postJson('/api/v1/bookings', array_merge($this->validBookingData, [
                    'errand_type_id' => $retired->id,
                    'shopping_budget' => 500,
                ]))
                ->assertStatus(422)
                ->assertJsonValidationErrors(['errand_type_id']);

            $this->actingAs($this->customer)
                ->postJson('/api/v1/bookings/estimate', [
                    'errand_type_id' => $retired->id,
                    'pickup_lat' => 14.5995, 'pickup_lng' => 120.9842,
                    'dropoff_lat' => 14.5547, 'dropoff_lng' => 121.0244,
                ])
                ->assertStatus(422)
                ->assertJsonValidationErrors(['errand_type_id']);
        }

        $this->assertSame(0, Booking::count());
    }

    public function test_a_request_without_pricing_mode_is_a_normal_fixed_price_booking(): void
    {
        // The app no longer sends pricing_mode at all — every errand is fixed
        // price.
        Bus::fake();
        $data = $this->validBookingData;
        unset($data['pricing_mode']);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data)
            ->assertCreated()
            ->assertJsonPath('data.pricing_mode', 'fixed')
            ->assertJsonPath('data.customer_offer', null);

        $booking = Booking::firstOrFail();
        $this->assertSame('fixed', $booking->pricing_mode);
        $this->assertGreaterThan(0, (float) $booking->total_amount);
        Bus::assertDispatched(\App\Jobs\MatchRunnerJob::class);
    }

    public function test_a_leftover_name_your_price_request_is_refused_not_overcharged(): void
    {
        // "Name your price" is retired, but the app build already on phones can
        // still send pricing_mode=negotiate with a customer_offer. Charging that
        // customer the full fixed fare instead of their offer would take more
        // than they agreed to (a wallet booking is debited at once), so it is
        // refused with a message telling them what to do.
        Bus::fake();

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', array_merge($this->validBookingData, [
                'pricing_mode' => 'negotiate',
                'vehicle_type_rate' => null,
                'customer_offer' => 10.00,
            ]))
            ->assertStatus(422)
            ->assertJsonPath(
                'errors.pricing_mode.0',
                'Name your price is no longer available. Please update the app and book at the fixed price.',
            );

        $this->assertSame(0, Booking::count());
        Bus::assertNotDispatched(\App\Jobs\MatchRunnerJob::class);
    }

    public function test_an_older_build_sending_fixed_mode_still_books_normally(): void
    {
        // The shipped app sends pricing_mode=fixed on every normal booking; the
        // new app sends no mode at all. Both are the same fixed-price booking.
        Bus::fake();

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->validBookingData)
            ->assertCreated();
        $plain = Booking::firstOrFail();

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', array_merge($this->validBookingData, [
                'pricing_mode' => 'fixed',
                'customer_offer' => 999.00,
            ]))
            ->assertCreated()
            ->assertJsonPath('data.pricing_mode', 'fixed')
            ->assertJsonPath('data.customer_offer', null);

        $older = Booking::whereKeyNot($plain->id)->firstOrFail();
        $this->assertEquals((float) $plain->total_amount, (float) $older->total_amount);
        $this->assertEquals((float) $plain->runner_payout, (float) $older->runner_payout);
        Bus::assertDispatchedTimes(\App\Jobs\MatchRunnerJob::class, 2);
    }

    public function test_a_booking_without_a_vehicle_is_priced_as_a_motorcycle(): void
    {
        Bus::fake();

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->validBookingData, 'vehicle_type_rate' => null])
            ->assertCreated()
            ->assertJsonPath('data.vehicle_type_rate', 'motorcycle')
            ->assertJsonPath('data.vehicle_type', 'motorcycle');
    }

    public function test_an_instant_matching_failure_after_the_wallet_was_charged_still_returns_the_booking(): void
    {
        // The wallet is debited before the instant runner search runs. If that
        // search throws (a deadlock under load), failing the request made the
        // app show an error, the customer tapped again, and the retry created —
        // and charged — a second booking. Now the booking stands, the response
        // is the normal 201, and the search is handed to the queue.
        Queue::fake();
        $this->customer->update(['wallet_balance' => 5000]);
        $this->app->instance(\App\Services\MatchingService::class, new class extends \App\Services\MatchingService
        {
            public function findRunner(string $bookingId, ?float $radiusOverrideKm = null, ?string $excludeUserId = null): ?\App\Models\RunnerProfile
            {
                throw new \RuntimeException('Deadlock found when trying to get lock');
            }
        });

        $first = $this->actingAs($this->customer)
            ->withHeader('Idempotency-Key', 'tap-once')
            ->postJson('/api/v1/bookings', [...$this->validBookingData, 'payment_method' => 'wallet'])
            ->assertCreated()
            ->assertJsonPath('data.status', 'pending');

        $booking = Booking::firstOrFail();
        $this->assertSame($first->json('data.id'), $booking->id);
        $this->assertSame('paid', $booking->payment_status);
        Queue::assertPushed(
            \App\Jobs\MatchRunnerJob::class,
            fn (\App\Jobs\MatchRunnerJob $job) => $job->bookingId === $booking->id,
        );
        Queue::assertPushed(\App\Jobs\AutoCancelBookingJob::class);

        // The duplicate-request guard still holds: the same tap replayed is the
        // same booking, charged once.
        $this->actingAs($this->customer)
            ->withHeader('Idempotency-Key', 'tap-once')
            ->postJson('/api/v1/bookings', [...$this->validBookingData, 'payment_method' => 'wallet'])
            ->assertCreated()
            ->assertJsonPath('data.id', $booking->id);

        $this->assertSame(1, Booking::count());
        $this->assertEquals(5000 - (float) $booking->total_amount, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_a_leftover_promo_code_is_ignored_and_the_full_price_is_charged(): void
    {
        // Promo codes are retired, but the app build already on phones still
        // sends `promo_code` when a code was applied to a draft before the
        // update. It must be accepted and simply ignored: same fare as a
        // booking without it, no discount, never a 422.
        Bus::fake();
        $this->customer->update(['wallet_balance' => 5000]);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->validBookingData, 'payment_method' => 'wallet'])
            ->assertCreated();
        $plain = Booking::firstOrFail();

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->validBookingData, 'payment_method' => 'wallet', 'promo_code' => 'SAVE10'])
            ->assertCreated()
            ->assertJsonPath('data.promo_discount', '0.00');
        $withCode = Booking::whereKeyNot($plain->id)->firstOrFail();

        $this->assertEquals(0.0, (float) $withCode->promo_discount);
        $this->assertGreaterThan(0, (float) $withCode->total_amount);
        $this->assertEquals((float) $plain->total_amount, (float) $withCode->total_amount);
        // The wallet paid the full fare for both bookings.
        $this->assertEquals(
            5000 - 2 * (float) $plain->total_amount,
            (float) $this->customer->fresh()->wallet_balance,
        );
    }

    public function test_online_payment_failure_marks_booking_failed_without_orphaning_or_500(): void
    {
        // The gateway invoice creation fails. Old code hard-deleted the booking
        // while a Payment FK referenced it → Postgres 23503 / uncaught 500. It
        // must instead 422 and leave a terminal failed booking (payment review
        // P0-2).
        Bus::fake();
        Http::fake(['api.xendit.co/*' => Http::response(['message' => 'bad request'], 400)]);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->validBookingData, 'payment_method' => 'gcash'])
            ->assertStatus(422); // NOT 500

        $booking = Booking::first();
        $this->assertNotNull($booking, 'booking must be kept as a failed record, not hard-deleted');
        $this->assertEquals('cancelled', $booking->status);
        $this->assertEquals('failed', $booking->payment_status);
        // The Payment row still references it (proves delete would have FK-failed).
        $this->assertDatabaseHas('payments', ['booking_id' => $booking->id, 'status' => 'failed']);
    }

    public function test_scheduled_booking_creation(): void
    {
        Bus::fake();

        $scheduledAt = now()->addDay()->setHour(10)->setMinute(0);

        $data = array_merge($this->validBookingData, [
            'schedule_type' => 'scheduled',
            'scheduled_at' => $scheduledAt->toIso8601String(),
        ]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(201)
            ->assertJsonPath('data.schedule_type', 'scheduled');

        $this->assertDatabaseHas('bookings', [
            'customer_id' => $this->customer->id,
            'schedule_type' => 'scheduled',
        ]);
    }

    public function test_match_runner_job_dispatched_for_fixed_pricing(): void
    {
        Bus::fake();

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->validBookingData);

        Bus::assertDispatched(\App\Jobs\MatchRunnerJob::class);
    }

    public function test_booking_requires_errand_type(): void
    {
        $data = $this->validBookingData;
        unset($data['errand_type_id']);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['errand_type_id']);
    }

    public function test_booking_requires_pickup_and_dropoff(): void
    {
        $data = $this->validBookingData;
        unset($data['pickup_address'], $data['pickup_lat'], $data['dropoff_address'], $data['dropoff_lat']);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['pickup_address', 'pickup_lat', 'dropoff_address', 'dropoff_lat']);
    }

    public function test_booking_rejects_inactive_errand_type(): void
    {
        $inactiveType = ErrandType::create([
            'slug' => 'inactive-type', 'name' => 'Inactive', 'description' => 'An inactive type',
            'icon_name' => 'X', 'base_fee' => 50.00, 'per_km_walk' => 10.00,
            'per_km_bicycle' => 10.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 10.00,
            'is_active' => false, 'sort_order' => 99,
        ]);

        $data = array_merge($this->validBookingData, [
            'errand_type_id' => $inactiveType->id,
        ]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['errand_type_id']);
    }

    public function test_scheduled_booking_rejects_past_date(): void
    {
        $data = array_merge($this->validBookingData, [
            'schedule_type' => 'scheduled',
            'scheduled_at' => now()->subHour()->toIso8601String(),
        ]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['scheduled_at']);
    }

    public function test_unauthenticated_user_cannot_create_booking(): void
    {
        $response = $this->postJson('/api/v1/bookings', $this->validBookingData);

        $response->assertStatus(401);
    }

    public function test_runner_cannot_create_booking(): void
    {
        $runner = User::factory()->create([
            'role' => 'runner',
            'status' => 'active',
        ]);

        $response = $this->actingAs($runner)
            ->postJson('/api/v1/bookings', $this->validBookingData);

        $response->assertStatus(403);
    }
}
