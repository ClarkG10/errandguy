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
            'min_negotiate_fee' => 30.00,
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
                'min_negotiate_fee' => 30.00, 'is_active' => false, 'sort_order' => 10 + $i,
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

    public function test_negotiate_mode_booking(): void
    {
        Bus::fake();

        $data = array_merge($this->validBookingData, [
            'pricing_mode' => 'negotiate',
            'vehicle_type_rate' => null,
            'customer_offer' => 100.00,
        ]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(201)
            ->assertJsonPath('data.pricing_mode', 'negotiate');

        $this->assertDatabaseHas('bookings', [
            'customer_id' => $this->customer->id,
            'pricing_mode' => 'negotiate',
            'customer_offer' => 100.00,
        ]);
    }

    public function test_negotiate_offer_of_zero_is_rejected_by_the_min_fee_floor(): void
    {
        Bus::fake();

        // customer_offer: 0 is falsy in PHP — the floor guard used to skip it,
        // letting a free (total 0 / payout 0) negotiate booking through. It
        // must now be rejected exactly like any other sub-min offer.
        $data = array_merge($this->validBookingData, [
            'pricing_mode' => 'negotiate',
            'vehicle_type_rate' => null,
            'customer_offer' => 0,
        ]);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data)
            ->assertStatus(422)
            ->assertJsonValidationErrors(['customer_offer']);

        $this->assertDatabaseMissing('bookings', [
            'customer_id' => $this->customer->id,
            'pricing_mode' => 'negotiate',
        ]);
    }

    public function test_negotiate_booking_is_charged_the_customer_offer(): void
    {
        Bus::fake();

        $data = array_merge($this->validBookingData, [
            'pricing_mode' => 'negotiate',
            'vehicle_type_rate' => 'motorcycle',
            'customer_offer' => 200.00,
        ]);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data)
            ->assertStatus(201);

        $booking = \App\Models\Booking::where('customer_id', $this->customer->id)
            ->latest()->firstOrFail();

        // The customer pays their OFFER, not the fixed fare (this exact value
        // would not arise from the distance/vehicle calc, so it also guards the
        // override from being silently removed).
        $this->assertEquals(200.00, (float) $booking->total_amount);
        // Platform keeps its flat computed service fee; the runner gets the rest.
        $this->assertEquals(
            round(200.00 - (float) $booking->service_fee, 2),
            (float) $booking->runner_payout,
        );
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

    public function test_a_leftover_promo_code_on_a_negotiate_booking_still_charges_the_offer(): void
    {
        Bus::fake();

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', array_merge($this->validBookingData, [
                'pricing_mode' => 'negotiate',
                'vehicle_type_rate' => 'motorcycle',
                'customer_offer' => 200.00,
                'promo_code' => 'SAVE10',
            ]))
            ->assertCreated();

        $booking = Booking::firstOrFail();
        $this->assertEquals(200.00, (float) $booking->total_amount);
        $this->assertEquals(0.0, (float) $booking->promo_discount);
        $this->assertEquals(
            round(200.00 - (float) $booking->service_fee, 2),
            (float) $booking->runner_payout,
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

    public function test_broadcast_job_dispatched_for_negotiate_pricing(): void
    {
        Bus::fake();

        $data = array_merge($this->validBookingData, [
            'pricing_mode' => 'negotiate',
            'vehicle_type_rate' => null,
            'customer_offer' => 100.00,
        ]);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        Bus::assertDispatched(\App\Jobs\BroadcastToRunnersJob::class);
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
            'min_negotiate_fee' => 30.00, 'is_active' => false, 'sort_order' => 99,
        ]);

        $data = array_merge($this->validBookingData, [
            'errand_type_id' => $inactiveType->id,
        ]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['errand_type_id']);
    }

    public function test_negotiate_booking_rejects_offer_below_minimum(): void
    {
        $data = array_merge($this->validBookingData, [
            'pricing_mode' => 'negotiate',
            'vehicle_type_rate' => null,
            'customer_offer' => 10.00,
        ]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['customer_offer']);
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

    public function test_fixed_pricing_requires_vehicle_type(): void
    {
        $data = array_merge($this->validBookingData, [
            'pricing_mode' => 'fixed',
            'vehicle_type_rate' => null,
        ]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['vehicle_type_rate']);
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
