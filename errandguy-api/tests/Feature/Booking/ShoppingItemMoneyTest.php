<?php

namespace Tests\Feature\Booking;

use App\Http\Resources\BookingResource;
use App\Jobs\AutoCancelBookingJob;
use App\Jobs\MatchRunnerJob;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\SystemConfig;
use App\Models\User;
use App\Services\CacheService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * "Buy for me" item money: the runner pays for the items out of pocket and the
 * customer repays them in cash at the door — nothing is charged online for
 * items. So what a runner can be asked to front is capped by a staff-adjustable
 * setting (₱3,000 to start, down from ₱50,000), the app is told the cap, and
 * the booking says plainly what is owed in cash.
 */
class ShoppingItemMoneyTest extends TestCase
{
    use RefreshDatabase;

    private const MIGRATION = 'migrations/2026_10_31_000005_add_shopping_budget_max_setting.php';

    private User $customer;
    private ErrandType $purchase;
    private ErrandType $delivery;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        Bus::fake([MatchRunnerJob::class, AutoCancelBookingJob::class]);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->purchase = ErrandType::create([
            'slug' => 'purchase', 'name' => 'Buy for me', 'description' => 'We buy it for you',
            'icon_name' => 'ShoppingBag', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'is_active' => true, 'sort_order' => 1,
        ]);
        $this->delivery = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Send packages',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'is_active' => true, 'sort_order' => 2,
        ]);
    }

    private function bookShopping(float $budget): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($this->customer)->postJson('/api/v1/bookings', [
            'errand_type_id' => $this->purchase->id,
            'pickup_address' => 'SM Makati', 'pickup_lat' => 14.5995, 'pickup_lng' => 120.9842,
            'dropoff_address' => '456 Oak Ave, Makati', 'dropoff_lat' => 14.5547, 'dropoff_lng' => 121.0244,
            'schedule_type' => 'now', 'payment_method' => 'cash',
            'shopping_budget' => $budget,
        ]);
    }

    private function migrate(string $direction = 'up'): void
    {
        $migration = require database_path(self::MIGRATION);
        $migration->{$direction}();
    }

    // ── The cap ──────────────────────────────────────────────────────────

    public function test_a_runner_can_be_asked_to_front_up_to_3000_by_default(): void
    {
        $this->bookShopping(3000)->assertCreated()->assertJsonPath('data.shopping_budget', '3000.00');

        $this->bookShopping(3000.01)
            ->assertStatus(422)
            ->assertJsonPath('errors.shopping_budget.0', 'The most a runner can pay for your items is ₱3,000.');
    }

    public function test_staff_can_change_the_cap_and_it_applies_at_once(): void
    {
        // Warm every cache the cap is read through first.
        $this->bookShopping(4000)->assertStatus(422);
        $this->getJson('/api/v1/errand-types')->assertJsonPath('data.0.shopping_budget_max', 3000);

        // A staff edit in the admin panel saves the model directly.
        SystemConfig::findOrFail('shopping_budget_max')->update(['value' => '5000']);

        $this->bookShopping(4000)->assertCreated();
        $this->bookShopping(5500)
            ->assertStatus(422)
            ->assertJsonPath('errors.shopping_budget.0', 'The most a runner can pay for your items is ₱5,000.');
        $this->getJson('/api/v1/errand-types')->assertJsonPath('data.0.shopping_budget_max', 5000);
    }

    public function test_a_broken_setting_falls_back_to_the_default_cap(): void
    {
        SystemConfig::findOrFail('shopping_budget_max')->update(['value' => 'lots']);

        $this->assertSame(3000.0, ErrandType::shoppingBudgetMax());
        $this->bookShopping(3500)->assertStatus(422);
    }

    public function test_the_catalog_tells_the_app_the_cap_on_shopping_types_only(): void
    {
        $types = collect($this->getJson('/api/v1/errand-types')->assertOk()->json('data'))->keyBy('slug');

        $this->assertSame(3000, $types['purchase']['shopping_budget_max']);
        $this->assertArrayNotHasKey('shopping_budget_max', $types['delivery']);

        $home = collect($this->actingAs($this->customer)->getJson('/api/v1/customer/home')->assertOk()->json('data.errand_types'))
            ->keyBy('slug');
        $this->assertSame(3000, $home['purchase']['shopping_budget_max']);
    }

    // ── The data migration ───────────────────────────────────────────────

    public function test_the_migration_creates_the_setting_once_and_keeps_a_staff_value(): void
    {
        DB::table('system_config')->where('key', 'shopping_budget_max')->delete();

        $this->migrate();
        $this->migrate();

        $this->assertSame(['3000'], DB::table('system_config')->where('key', 'shopping_budget_max')->pluck('value')->all());

        DB::table('system_config')->where('key', 'shopping_budget_max')->update(['value' => '2500']);
        $this->migrate();
        $this->assertSame('2500', DB::table('system_config')->where('key', 'shopping_budget_max')->value('value'));

        $this->migrate('down');
        $this->assertFalse(DB::table('system_config')->where('key', 'shopping_budget_max')->exists());
        $this->assertSame(3000.0, ErrandType::shoppingBudgetMax(), 'the code default matches');
    }

    public function test_the_migration_drops_the_cached_catalog(): void
    {
        $this->getJson('/api/v1/errand-types')->assertOk();
        $this->assertNotNull(Cache::get(CacheService::errandTypesKey()));

        $this->migrate();

        $this->assertNull(Cache::get(CacheService::errandTypesKey()));
    }

    // ── What the booking says about item money ───────────────────────────

    public function test_the_booking_says_items_are_paid_in_cash_once_the_cost_is_known(): void
    {
        $this->bookShopping(1500)->assertCreated()
            ->assertJsonPath('data.shopping_budget', '1500.00')
            ->assertJsonPath('data.actual_item_cost', null)
            ->assertJsonPath('data.items_cash_due', null)
            ->assertJsonPath('data.items_payment_note', BookingResource::ITEMS_PAYMENT_NOTE);

        $booking = Booking::firstOrFail();
        $booking->update(['actual_item_cost' => 1234.5]);

        $this->actingAs($this->customer)->getJson("/api/v1/bookings/{$booking->id}")
            ->assertJsonPath('data.actual_item_cost', '1234.50')
            ->assertJsonPath('data.items_cash_due', 1234.5)
            ->assertJsonPath('data.items_payment_note', BookingResource::ITEMS_PAYMENT_NOTE);
    }

    public function test_a_non_shopping_errand_carries_no_item_money(): void
    {
        $this->actingAs($this->customer)->postJson('/api/v1/bookings', [
            'errand_type_id' => $this->delivery->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.5995, 'pickup_lng' => 120.9842,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.5547, 'dropoff_lng' => 121.0244,
            'schedule_type' => 'now', 'payment_method' => 'cash',
        ])->assertCreated()
            ->assertJsonPath('data.items_cash_due', null)
            ->assertJsonPath('data.items_payment_note', null);
    }

    public function test_the_runner_is_told_the_limit_not_a_pre_authorised_budget(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $booking = Booking::create([
            'booking_number' => 'EG-20261031-SHOPCAP',
            'customer_id' => $this->customer->id, 'runner_id' => $runner->id,
            'errand_type_id' => $this->purchase->id, 'status' => 'arrived_at_pickup',
            'payment_method' => 'cash', 'payment_status' => 'unpaid',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'shopping_budget' => 500, 'is_transportation' => false,
        ]);

        $this->actingAs($runner)
            ->post("/api/v1/runner/errand/{$booking->id}/status", [
                'status' => 'picked_up',
                'actual_item_cost' => 650,
                'receipt_photo' => \Illuminate\Http\UploadedFile::fake()->image('receipt.jpg'),
            ], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonPath('errors.actual_item_cost.0', 'Amount cannot exceed the customer’s spending limit for the items.');
    }
}
