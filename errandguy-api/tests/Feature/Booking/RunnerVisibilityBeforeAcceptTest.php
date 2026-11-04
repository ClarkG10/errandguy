<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerLocation;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * A customer meets their runner when the runner ACCEPTS. While an errand is
 * only offered, the runner may decline and is a stranger — and cancelling an
 * unaccepted cash errand is free — so booking anywhere used to reveal the
 * nearest runner's name, phone and live position. Now: nothing before the
 * accept, name and phone while the errand is worked, no phone after it ends.
 */
class RunnerVisibilityBeforeAcceptTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'phone' => '+639171112222', 'full_name' => 'Rhea Runner']);
        RunnerProfile::create(['user_id' => $this->runner->id, 'verification_status' => 'approved', 'is_online' => true, 'vehicle_type' => 'motorcycle', 'preferred_types' => []]);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'x', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
        $this->booking = Booking::create([
            'booking_number' => 'EG-VIS-1', 'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $type->id, 'status' => 'matched', 'payment_status' => 'unpaid', 'payment_method' => 'cash',
            'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 100, 'is_transportation' => false,
        ]);
        RunnerLocation::create(['runner_id' => $this->runner->id, 'booking_id' => $this->booking->id, 'lat' => 14.601, 'lng' => 120.981]);
    }

    private function track(): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($this->customer)->getJson("/api/v1/bookings/{$this->booking->id}/track")->assertOk();
    }

    public function test_an_offered_runner_is_not_revealed_to_the_customer(): void
    {
        $data = $this->track()->json('data');
        $this->assertArrayNotHasKey('runner', $data['booking']);
        $this->assertNull($data['runner_location']);
        $this->assertNull($this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$this->booking->id}/track?only=location")->json('data.runner_location'));
        $this->assertStringNotContainsString('+639171112222', $this->track()->getContent());
    }

    public function test_once_accepted_the_customer_sees_and_can_call_their_runner(): void
    {
        $this->booking->update(['status' => 'accepted', 'accepted_at' => now()]);

        $data = $this->track()->json('data');
        $this->assertSame('Rhea Runner', $data['booking']['runner']['full_name']);
        $this->assertSame('+639171112222', $data['booking']['runner']['phone']);
        $this->assertNotNull($data['runner_location']);
    }

    public function test_after_the_errand_the_runner_phone_is_gone_from_the_history(): void
    {
        $this->booking->update(['status' => 'completed', 'accepted_at' => now()->subHour(), 'completed_at' => now()]);

        $row = collect($this->actingAs($this->customer)->getJson('/api/v1/bookings')->assertOk()->json('data'))
            ->firstWhere('id', $this->booking->id);
        $this->assertSame('Rhea Runner', $row['runner']['full_name'] ?? null);
        $this->assertNull($row['runner']['phone'] ?? null);
    }

    public function test_an_offered_runner_s_pings_are_not_tagged_to_the_errand(): void
    {
        $this->actingAs($this->runner)
            ->postJson('/api/v1/runner/location', ['lat' => 14.602, 'lng' => 120.982, 'booking_id' => $this->booking->id])
            ->assertOk();

        $this->assertSame(1, RunnerLocation::where('booking_id', $this->booking->id)->count());
    }

    public function test_a_runner_who_was_only_offered_the_errand_never_gets_the_phone_numbers(): void
    {
        $this->customer->update(['phone' => '+639283334444']);
        $this->booking->update(['pickup_contact_phone' => '+639175556666', 'dropoff_contact_phone' => '+639177778888']);

        // The customer cancels while it is still only an offer.
        $this->booking->update(['status' => 'cancelled', 'cancelled_at' => now()]);

        $body = $this->actingAs($this->runner)->getJson('/api/v1/runner/errands/history')->assertOk()->getContent();
        foreach (['+639283334444', '+639175556666', '+639177778888'] as $phone) {
            $this->assertStringNotContainsString($phone, $body);
        }
    }

    public function test_sos_answers_with_a_summary_not_the_errand(): void
    {
        $this->booking->update(['status' => 'accepted', 'accepted_at' => now(), 'pickup_contact_phone' => '+639175556666']);

        $res = $this->actingAs($this->runner)->postJson("/api/v1/runner/errand/{$this->booking->id}/sos")->assertCreated();

        $this->assertSame($this->booking->id, $res->json('data.booking_id'));
        $this->assertNull($res->json('data.booking'));
        $this->assertStringNotContainsString('+639175556666', $res->getContent());
    }

    public function test_cancelling_during_the_offer_does_not_reveal_the_runner_either(): void
    {
        $this->booking->update(['status' => 'cancelled', 'cancelled_at' => now()]);

        $show = $this->actingAs($this->customer)->getJson("/api/v1/bookings/{$this->booking->id}")->assertOk();
        $this->assertNull($show->json('data.runner'));
        $this->assertStringNotContainsString('Rhea Runner', $show->getContent());

        $list = $this->actingAs($this->customer)->getJson('/api/v1/bookings')->assertOk();
        $this->assertStringNotContainsString('Rhea Runner', $list->getContent());
    }

    public function test_the_chat_inbox_does_not_name_an_offered_runner(): void
    {
        $conversations = $this->actingAs($this->customer)->getJson('/api/v1/chat/conversations')->assertOk();
        $this->assertStringNotContainsString('Rhea Runner', $conversations->getContent());
    }
}
