<?php

namespace Tests\Feature\Jobs;

use App\Events\BookingStatusChanged;
use App\Events\OfferWithdrawn;
use App\Jobs\RetractOfferJob;
use App\Listeners\RetractBroadcastOffers;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * A negotiate booking fans a persistent 'incoming_request' card out to every
 * nearby runner. Nothing used to take them back, so once one runner won, all
 * the others kept a live-looking offer forever and tapping accept just returned
 * BOOKING_STALE.
 */
class RetractOfferTest extends TestCase
{
    use RefreshDatabase;

    private function negotiateBooking(array $overrides = []): Booking
    {
        $customer = User::factory()->create(['role' => 'customer']);
        // firstOrCreate: several tests here build two bookings, and the slug is
        // unique.
        $type = ErrandType::firstOrCreate(
            ['slug' => 'delivery'],
            [
                'name' => 'Delivery', 'description' => 'D',
                'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
                'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
                'is_active' => true, 'sort_order' => 1,
            ],
        );

        return Booking::create(array_merge([
            'booking_number' => 'EG-R-'.uniqid(),
            'customer_id' => $customer->id,
            'errand_type_id' => $type->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'negotiate', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false, 'status' => 'pending',
        ], $overrides));
    }

    private function offerCard(User $runner, Booking $booking): Notification
    {
        return Notification::create([
            'user_id' => $runner->id,
            'type' => 'incoming_request',
            'title' => 'New Errand Request',
            'body' => 'A new errand is available near you.',
            'data' => ['type' => 'incoming_request', 'booking_id' => $booking->id],
        ]);
    }

    public function test_losing_runners_lose_the_card_and_the_winner_keeps_theirs(): void
    {
        Event::fake([OfferWithdrawn::class]);

        $winner = User::factory()->create(['role' => 'runner']);
        $loserA = User::factory()->create(['role' => 'runner']);
        $loserB = User::factory()->create(['role' => 'runner']);
        $booking = $this->negotiateBooking();

        foreach ([$winner, $loserA, $loserB] as $runner) {
            $this->offerCard($runner, $booking);
        }

        (new RetractOfferJob($booking->id, $winner->id, 'taken'))->handle();

        $this->assertDatabaseHas('notifications', ['user_id' => $winner->id, 'type' => 'incoming_request']);
        $this->assertDatabaseMissing('notifications', ['user_id' => $loserA->id, 'type' => 'incoming_request']);
        $this->assertDatabaseMissing('notifications', ['user_id' => $loserB->id, 'type' => 'incoming_request']);

        Event::assertDispatched(OfferWithdrawn::class, fn (OfferWithdrawn $e) => $e->userId === $loserA->id);
        Event::assertDispatched(OfferWithdrawn::class, fn (OfferWithdrawn $e) => $e->userId === $loserB->id);
        Event::assertNotDispatched(OfferWithdrawn::class, fn (OfferWithdrawn $e) => $e->userId === $winner->id);
    }

    public function test_offers_for_other_bookings_are_untouched(): void
    {
        Event::fake([OfferWithdrawn::class]);

        $runner = User::factory()->create(['role' => 'runner']);
        $taken = $this->negotiateBooking();
        $stillOpen = $this->negotiateBooking();

        $this->offerCard($runner, $taken);
        $this->offerCard($runner, $stillOpen);

        (new RetractOfferJob($taken->id, null, 'taken'))->handle();

        $this->assertSame(
            1,
            Notification::where('user_id', $runner->id)->where('type', 'incoming_request')->count(),
            'the unrelated open offer must survive',
        );
    }

    public function test_accepting_a_negotiate_booking_queues_the_retraction(): void
    {
        Bus::fake([RetractOfferJob::class]);

        $winner = User::factory()->create(['role' => 'runner']);
        $booking = $this->negotiateBooking(['status' => 'accepted', 'runner_id' => $winner->id]);

        (new RetractBroadcastOffers())->handle(
            new BookingStatusChanged($booking, 'pending', 'accepted'),
        );

        Bus::assertDispatched(
            RetractOfferJob::class,
            fn (RetractOfferJob $job) => $job->bookingId === $booking->id
                && $job->exceptUserId === $winner->id
                && $job->reason === 'taken',
        );
    }

    public function test_fixed_mode_bookings_do_not_trigger_a_sweep(): void
    {
        Bus::fake([RetractOfferJob::class]);

        $runner = User::factory()->create(['role' => 'runner']);
        $booking = $this->negotiateBooking([
            'pricing_mode' => 'fixed', 'status' => 'accepted', 'runner_id' => $runner->id,
        ]);

        (new RetractBroadcastOffers())->handle(
            new BookingStatusChanged($booking, 'matched', 'accepted'),
        );

        // A fixed match offers exactly one runner — there are no broadcast
        // cards to take back, so we must not queue a pointless sweep.
        Bus::assertNotDispatched(RetractOfferJob::class);
    }

    public function test_a_booking_still_pending_keeps_its_offers(): void
    {
        Bus::fake([RetractOfferJob::class]);

        $booking = $this->negotiateBooking();

        (new RetractBroadcastOffers())->handle(
            new BookingStatusChanged($booking, 'pending', 'pending'),
        );

        Bus::assertNotDispatched(RetractOfferJob::class);
    }

    public function test_retraction_is_idempotent(): void
    {
        Event::fake([OfferWithdrawn::class]);

        $runner = User::factory()->create(['role' => 'runner']);
        $booking = $this->negotiateBooking();
        $this->offerCard($runner, $booking);

        (new RetractOfferJob($booking->id, null, 'taken'))->handle();
        (new RetractOfferJob($booking->id, null, 'cancelled'))->handle();

        // Second pass finds nothing and must stay silent rather than
        // re-announcing a withdrawal for a card that is already gone.
        Event::assertDispatchedTimes(OfferWithdrawn::class, 1);
    }
}
