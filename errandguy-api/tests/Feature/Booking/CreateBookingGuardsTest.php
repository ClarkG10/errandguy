<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * What booking creation accepts and how it fails:
 *  - a long "Buy for me" list, written out into the description by the app,
 *    books instead of tripping the 500-character description limit;
 *  - a vehicle staff withdrew for the errand type (per-km rate 0) is refused,
 *    while a queue errand, always booked on foot, still books;
 *  - a database error while charging the wallet is a retryable server error,
 *    not "insufficient wallet balance", and takes no money.
 */
class CreateBookingGuardsTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        Bus::fake();

        $this->customer = User::factory()->create([
            'role' => 'customer', 'status' => 'active', 'wallet_balance' => 5000,
        ]);
    }

    private function type(string $slug, array $rates = []): ErrandType
    {
        return ErrandType::create(array_merge([
            'slug' => $slug, 'name' => ucfirst($slug), 'description' => $slug,
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'surcharge' => 0.00, 'is_active' => true, 'sort_order' => 1,
        ], $rates));
    }

    private function payload(ErrandType $type, array $extra = []): array
    {
        return array_merge([
            'errand_type_id' => $type->id,
            'pickup_address' => '123 Main St, Manila', 'pickup_lat' => 14.5995, 'pickup_lng' => 120.9842,
            'dropoff_address' => '456 Oak Ave, Makati', 'dropoff_lat' => 14.5547, 'dropoff_lng' => 121.0244,
            'description' => 'Please pick up a package',
            'schedule_type' => 'now',
            'vehicle_type_rate' => 'motorcycle',
            'payment_method' => 'cash',
        ], $extra);
    }

    /** The app's serializeChecklist() output for these items. */
    private function writtenOut(array $items): string
    {
        return "Shopping list:\n".implode("\n", array_map(fn ($i) => "• {$i['name']} ×{$i['qty']}", $items));
    }

    // ── Long shopping lists ──────────────────────────────────────────────

    public function test_a_forty_item_shopping_list_books(): void
    {
        $purchase = $this->type('purchase');
        $items = array_map(
            fn (int $n) => ['name' => "Item number {$n} from the grocery aisle", 'qty' => 2],
            range(1, 40),
        );
        $description = $this->writtenOut($items);
        $this->assertGreaterThan(500, mb_strlen($description));

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->payload($purchase, [
                'description' => $description,
                'shopping_items' => $items,
                'shopping_budget' => 2000,
            ]))
            ->assertCreated();

        $booking = Booking::firstOrFail();
        $this->assertSame($description, $booking->description);
        $this->assertCount(40, $booking->shopping_items);
    }

    public function test_a_plain_description_keeps_its_500_character_limit(): void
    {
        $delivery = $this->type('delivery');

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->payload($delivery, ['description' => str_repeat('a', 501)]))
            ->assertStatus(422)
            ->assertJsonValidationErrors(['description']);
    }

    // ── Withdrawn vehicles ───────────────────────────────────────────────

    public function test_a_vehicle_withdrawn_for_the_errand_type_is_refused(): void
    {
        $delivery = $this->type('delivery', ['per_km_car' => 0]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->payload($delivery, ['vehicle_type_rate' => 'car']))
            ->assertStatus(422)
            ->assertJsonValidationErrors(['vehicle_type_rate']);

        $this->assertStringContainsString('A car isn’t available for Delivery', (string) $response->json('errors.vehicle_type_rate.0'));
        $this->assertSame(0, Booking::count());
    }

    public function test_leaving_the_vehicle_out_does_not_skip_the_check(): void
    {
        // No vehicle books a motorcycle; with motorcycles withdrawn for this
        // type that used to price the errand on a ₱0/km rate.
        $delivery = $this->type('delivery', ['per_km_motorcycle' => 0]);
        $payload = $this->payload($delivery);
        unset($payload['vehicle_type_rate']);

        $this->actingAs($this->customer)->postJson('/api/v1/bookings', $payload)
            ->assertStatus(422)
            ->assertJsonValidationErrors(['vehicle_type_rate']);
        $this->assertSame(0, Booking::count());
    }

    public function test_a_vehicle_the_type_still_offers_books(): void
    {
        $delivery = $this->type('delivery', ['per_km_car' => 0]);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->payload($delivery, ['vehicle_type_rate' => 'motorcycle']))
            ->assertCreated();
    }

    public function test_a_queue_errand_still_books_on_foot_whatever_its_walking_rate(): void
    {
        // Queue has no trip, so staff may well zero its per-km rates. The app
        // hides the vehicle picker for it and always sends 'walk'.
        $queue = $this->type('queue', ['per_km_walk' => 0]);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->payload($queue, [
                'description' => 'DFA Pasay — passport claim',
                'dropoff_address' => null, 'dropoff_lat' => null, 'dropoff_lng' => null,
                'vehicle_type_rate' => 'walk',
            ]))
            ->assertCreated();
    }

    // ── Wallet charge failures ───────────────────────────────────────────

    public function test_a_database_error_while_charging_the_wallet_is_not_reported_as_a_low_balance(): void
    {
        $delivery = $this->type('delivery');

        // The debit has happened inside the transaction; the payment row then
        // fails to write. (Not a deadlock message: inside RefreshDatabase's own
        // transaction Laravel leaves a deadlocked savepoint for the outer level
        // to roll back, which in production is this very transaction.)
        Payment::creating(function () {
            throw new QueryException('mysql', 'insert into `payments` …', [], new \PDOException('SQLSTATE[HY000]: General error: 1030 Got error from storage engine'));
        });

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->payload($delivery, ['payment_method' => 'wallet']))
            ->assertStatus(500)
            ->assertJsonPath('code', 'SERVER_ERROR');

        // No SQL and no false reason reaches the customer.
        $this->assertStringNotContainsString('insert into', (string) $response->json('message'));
        $this->assertStringNotContainsString('balance', strtolower((string) $response->json('message')));

        // The debit rolled back with the transaction: no money moved.
        $this->assertEquals(5000.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertSame(0, WalletTransaction::where('type', 'payment')->count());

        // The booking is closed with the true reason, not left pending (a 5xx
        // releases the idempotency key, so the app's retry books afresh).
        $booking = Booking::firstOrFail();
        $this->assertSame('cancelled', $booking->status);
        $this->assertSame('failed', $booking->payment_status);
        $this->assertSame('Payment failed: the wallet charge could not be completed', $booking->cancellation_reason);
    }

    public function test_a_charge_that_committed_before_the_error_is_kept_and_the_errand_goes_ahead(): void
    {
        $delivery = $this->type('delivery');

        // A connection lost during COMMIT surfaces as an error after the
        // commit landed: throw from the moment the payment's transaction has
        // committed.
        Payment::created(fn () => DB::afterCommit(function () {
            throw new QueryException('mysql', 'commit', [], new \PDOException('SQLSTATE[HY000]: General error: 2006 MySQL server has gone away'));
        }));

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->payload($delivery, ['payment_method' => 'wallet']))
            ->assertCreated();

        // Paid once, and the errand is live — not failed with the debit
        // stranded, and not answered with a 5xx the app would retry (and pay)
        // again.
        $booking = Booking::sole();
        $this->assertSame('paid', $booking->payment_status);
        $this->assertNotSame('cancelled', $booking->status);
        $this->assertSame(1, WalletTransaction::where('type', 'payment')->count());
    }

    public function test_a_schedule_time_sent_with_an_offset_is_stored_as_the_same_moment(): void
    {
        $delivery = $this->type('delivery');
        $manila = now('Asia/Manila')->addDay()->setTime(10, 0);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->payload($delivery, [
                'payment_method' => 'cash',
                'schedule_type' => 'scheduled',
                'scheduled_at' => $manila->format('Y-m-d\\TH:i:sP'), // "…T10:00:00+08:00"
            ]))
            ->assertCreated();

        // 10:00 in Manila is 02:00 UTC — not 10:00 UTC (6 PM in Manila).
        $this->assertTrue(Booking::sole()->scheduled_at->equalTo($manila));
    }

    public function test_a_real_shortfall_is_still_reported_as_one(): void
    {
        $delivery = $this->type('delivery');
        $this->customer->update(['wallet_balance' => 1]);

        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', $this->payload($delivery, ['payment_method' => 'wallet']))
            ->assertStatus(422)
            ->assertJsonPath('code', 'INSUFFICIENT_WALLET_BALANCE');

        $this->assertStringContainsString('your wallet balance is ₱1.00', (string) $response->json('message'));
        $this->assertSame('Payment failed: insufficient wallet balance', Booking::firstOrFail()->cancellation_reason);
    }
}
