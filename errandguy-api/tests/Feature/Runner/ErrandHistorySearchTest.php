<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * History search has to reach the WHOLE history.
 *
 * The runner's search field is labelled "booking number, address, or type", but
 * address and type were filtered client-side over the loaded pages only — so a
 * runner looking for an errand from three months ago got "No matches for
 * EG-1234", with the empty state advising them to search by booking number,
 * the exact thing that could not work. The record was sitting unfetched on
 * page 12.
 *
 * The server now searches every field the app promises, so these pin that a
 * match beyond page one is actually found.
 */
class ErrandHistorySearchTest extends TestCase
{
    use RefreshDatabase;

    private User $runner;

    private ErrandType $delivery;

    private ErrandType $laundry;

    protected function setUp(): void
    {
        parent::setUp();

        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $this->delivery = $this->type('delivery', 'Delivery');
        $this->laundry = $this->type('laundry', 'Laundry Pickup');
    }

    private function type(string $slug, string $name): ErrandType
    {
        return ErrandType::create([
            'slug' => $slug, 'name' => $name, 'description' => 'D',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
            'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function errand(array $overrides = [], ?string $customerName = null): Booking
    {
        $customer = User::factory()->create([
            'role' => 'customer',
            ...($customerName ? ['full_name' => $customerName] : []),
        ]);

        return Booking::create(array_merge([
            'booking_number' => 'EG-'.uniqid(),
            'customer_id' => $customer->id,
            'runner_id' => $this->runner->id,
            'errand_type_id' => $this->delivery->id,
            'pickup_address' => 'Somewhere', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'Elsewhere', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false, 'status' => 'completed',
        ], $overrides));
    }

    /** @return list<string> booking numbers returned for this search */
    private function search(string $term): array
    {
        $response = $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/errands/history?per_page=15&search='.urlencode($term))
            ->assertOk();

        return collect($response->json('data'))->pluck('booking_number')->all();
    }

    /**
     * The case that was broken: the target is buried well past page one, so a
     * client-side filter over 15 loaded rows could never have found it.
     */
    public function test_a_booking_number_is_found_far_beyond_the_first_page(): void
    {
        for ($i = 0; $i < 40; $i++) {
            $this->errand();
        }
        $target = $this->errand(['booking_number' => 'EG-NEEDLE-1']);
        // Make it the OLDEST, so it sorts last and cannot be on page one.
        $target->forceFill(['created_at' => now()->subYear()])->save();

        $this->assertSame(['EG-NEEDLE-1'], $this->search('NEEDLE'));
    }

    public function test_an_address_is_searchable_because_the_app_promises_it(): void
    {
        $this->errand();
        $target = $this->errand([
            'booking_number' => 'EG-ADDR-1',
            'dropoff_address' => '42 Katipunan Avenue, Quezon City',
        ]);
        $target->forceFill(['created_at' => now()->subMonths(6)])->save();

        $this->assertSame(['EG-ADDR-1'], $this->search('Katipunan'));
    }

    public function test_an_errand_type_is_searchable_because_the_app_promises_it(): void
    {
        $this->errand();
        $target = $this->errand([
            'booking_number' => 'EG-TYPE-1',
            'errand_type_id' => $this->laundry->id,
        ]);
        $target->forceFill(['created_at' => now()->subMonths(6)])->save();

        $this->assertSame(['EG-TYPE-1'], $this->search('Laundry'));
    }

    public function test_a_customer_name_still_matches(): void
    {
        $this->errand();
        $target = $this->errand(['booking_number' => 'EG-NAME-1'], 'Bernadette Reyes');
        $target->forceFill(['created_at' => now()->subMonths(6)])->save();

        $this->assertSame(['EG-NAME-1'], $this->search('Bernadette'));
    }

    /**
     * Search must never widen the runner's own scope — someone else's errand is
     * not theirs to find, however they spell the term.
     */
    public function test_search_never_reaches_another_runners_errand(): void
    {
        $otherRunner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $this->errand(['booking_number' => 'EG-THEIRS-1', 'runner_id' => $otherRunner->id]);

        $this->assertSame([], $this->search('THEIRS'));
    }

    public function test_a_genuine_miss_still_returns_nothing(): void
    {
        $this->errand(['booking_number' => 'EG-REAL-1']);

        $this->assertSame([], $this->search('zzzz-no-such-thing'));
    }
}
