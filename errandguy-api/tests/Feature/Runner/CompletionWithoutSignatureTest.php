<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Finishing a handover nobody can sign for.
 *
 * The signature was a hard wall: a runner at a door nobody answers, or a guard
 * who won't sign, with the delivery photo already taken, had no way to close
 * the errand. A stated reason now stands in for the signature — but only on
 * top of that photo, only when no money is due at the door, and the reason is
 * kept on the completion's status log.
 */
class CompletionWithoutSignatureTest extends TestCase
{
    use RefreshDatabase;

    private User $runner;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        Event::fake();
        Storage::fake('media');

        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 0]);

        RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'preferred_types' => [], 'completion_rate' => 100.00, 'total_errands' => 0, 'total_earnings' => 0.00,
        ]);

        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'is_active' => true, 'sort_order' => 1,
        ]);

        $this->booking = Booking::create([
            'booking_number' => 'EG-20261103-NSIG',
            'customer_id' => $customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $type->id, 'status' => 'arrived_at_dropoff',
            // Prepaid: nothing to collect at the door. The cash cases below
            // switch this back to an unpaid cash fare.
            'payment_method' => 'gcash', 'payment_status' => 'paid',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 100, 'is_transportation' => false,
        ]);
    }

    private function deliverWithPhoto(): void
    {
        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/status", [
                'status' => 'delivered',
                'delivery_photo' => UploadedFile::fake()->image('d.jpg'),
            ])
            ->assertOk();
    }

    private function complete(array $data)
    {
        return $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/status", ['status' => 'completed', ...$data]);
    }

    public function test_a_reason_completes_the_errand_when_the_delivery_photo_is_on_file(): void
    {
        $this->deliverWithPhoto();

        $this->complete(['no_signature_reason' => 'left_with_guard'])
            ->assertOk()
            ->assertJsonPath('data.status', 'completed');

        $booking = $this->booking->fresh();
        $this->assertSame('completed', $booking->status);
        $this->assertNull($booking->signature_url);
        $this->assertDatabaseHas('booking_status_logs', [
            'booking_id' => $booking->id,
            'status' => 'completed',
            'note' => 'No signature: Left with guard or reception',
        ]);
        // Money settles exactly as a signed completion does: the prepaid
        // payout is credited.
        $this->assertEquals('100.00', $this->runner->fresh()->wallet_balance);
    }

    public function test_a_reason_is_refused_while_a_cash_fare_is_due(): void
    {
        // Completing would settle the cash as collected and debit the runner's
        // commission for money nobody paid. Whoever pays can also sign.
        $this->booking->update(['payment_method' => 'cash', 'payment_status' => 'unpaid']);
        $this->deliverWithPhoto();

        $response = $this->complete(['no_signature_reason' => 'recipient_unavailable'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['signature']);

        $this->assertStringContainsString('no money to collect', $response->json('errors.signature.0'));
        $this->assertSame('delivered', $this->booking->fresh()->status);
        $this->assertEquals('0.00', $this->runner->fresh()->wallet_balance);
    }

    public function test_a_reason_is_refused_while_item_money_is_due(): void
    {
        // A prepaid fare, but the runner fronted the shopping: the customer
        // still owes the item money in cash at the door.
        $this->booking->update(['actual_item_cost' => 250]);
        $this->deliverWithPhoto();

        $this->complete(['no_signature_reason' => 'left_with_guard'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['signature']);
        $this->assertSame('delivered', $this->booking->fresh()->status);
    }

    public function test_other_needs_a_short_note_which_is_kept(): void
    {
        $this->deliverWithPhoto();

        $this->complete(['no_signature_reason' => 'other'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['note']);
        $this->assertSame('delivered', $this->booking->fresh()->status);

        $this->complete(['no_signature_reason' => 'other', 'note' => 'Handed to the neighbour, Aling Nena'])
            ->assertOk();
        $this->assertDatabaseHas('booking_status_logs', [
            'booking_id' => $this->booking->id,
            'status' => 'completed',
            'note' => 'No signature: Other — Handed to the neighbour, Aling Nena',
        ]);
    }

    public function test_no_reason_and_no_signature_is_still_refused(): void
    {
        $this->deliverWithPhoto();

        $this->complete([])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['signature']);
        $this->assertSame('delivered', $this->booking->fresh()->status);
    }

    public function test_a_reason_without_a_delivery_photo_is_refused(): void
    {
        // An errand that reached `delivered` without a photo on file (an older
        // row, or staff moving it) cannot be closed on a reason alone.
        $this->booking->update(['status' => 'delivered', 'delivery_photo_url' => null]);

        $response = $this->complete(['no_signature_reason' => 'recipient_unavailable'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['signature']);

        $this->assertStringContainsString('delivery photo', $response->json('errors.signature.0'));
        $this->assertSame('delivered', $this->booking->fresh()->status);
    }

    public function test_an_unknown_reason_is_refused(): void
    {
        $this->deliverWithPhoto();

        $this->complete(['no_signature_reason' => 'felt_like_it'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['no_signature_reason']);
    }

    public function test_a_signature_still_works_and_needs_no_reason(): void
    {
        $this->deliverWithPhoto();

        $this->complete(['signature' => UploadedFile::fake()->image('s.png')])->assertOk();

        $this->assertNotNull($this->booking->fresh()->signature_url);
        $this->assertDatabaseHas('booking_status_logs', [
            'booking_id' => $this->booking->id,
            'status' => 'completed',
            'note' => null,
        ]);
    }

    public function test_the_customer_sees_the_reason_in_the_status_history(): void
    {
        $this->deliverWithPhoto();
        $this->complete(['no_signature_reason' => 'customer_asked'])->assertOk();

        $customer = User::find($this->booking->customer_id);
        $logs = $this->actingAs($customer)
            ->getJson("/api/v1/bookings/{$this->booking->id}")
            ->assertOk()
            ->json('data.status_logs');

        $this->assertContains(
            'No signature: Customer asked me to leave it',
            array_column($logs ?? [], 'note'),
        );
    }
}
