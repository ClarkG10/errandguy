<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Services\CacheService;
use Database\Seeders\ErrandTypeSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Launch catalog: ten errand types became four (Delivery, Buy for me,
 * Queue / Pila, Custom errand), passenger rides and Bills Payment are gone,
 * and deploys no longer overwrite staff edits to the catalog.
 *
 * Pins the three moving parts:
 *   - ErrandTypeSeeder runs on every deploy, so it may only CREATE a missing
 *     type — never reset one staff edited;
 *   - 2026_10_30_000001 switches the retired types off (rows kept for history),
 *     renames the kept ones and remaps runners' preferred types;
 *   - an errand booked before the retirement still finishes — a ride along the
 *     ordinary delivery steps, food/grocery and bills along their own.
 */
class ErrandCatalogSimplificationTest extends TestCase
{
    use RefreshDatabase;

    private const MIGRATION = 'migrations/2026_10_30_000001_simplify_errand_catalog.php';

    private const ACTIVE = ['delivery', 'purchase', 'queue', 'custom'];

    private const RETIRED = ['document', 'laundry', 'food', 'grocery', 'bills_payment', 'transportation'];

    /**
     * The catalog as every deploy before this one left it: all ten types
     * active, under the old seeder's names and order.
     */
    private function seedLegacyCatalog(): void
    {
        $legacy = [
            'delivery' => ['Delivery', 'Send or receive packages and items'],
            'grocery' => ['Grocery', 'Get groceries and essentials delivered'],
            'food' => ['Food Pickup', 'Order food from your favorite restaurants'],
            'document' => ['Document', 'Send or collect important documents'],
            'laundry' => ['Laundry', 'Laundry pickup and delivery service'],
            'transportation' => ['Transportation', 'Get a ride to your destination'],
            'bills_payment' => ['Bills Payment', 'Pay your bills at any payment center'],
            'queue' => ['Queue / Line', 'Have someone wait in line for you'],
            'purchase' => ['Purchase & Deliver', 'Buy something and have it delivered'],
            'custom' => ['Custom Errand', 'Any other errand you need done'],
        ];

        $order = 0;
        foreach ($legacy as $slug => [$name, $description]) {
            $this->type($slug, true, ['name' => $name, 'description' => $description, 'sort_order' => ++$order]);
        }
    }

    /**
     * Rows are written without model events: they stand in for rows that
     * already exist in production, which the "removed types stay off" guard
     * never touches until someone saves them.
     */
    private function type(string $slug, bool $active = true, array $overrides = []): ErrandType
    {
        return ErrandType::withoutEvents(fn () => ErrandType::create(array_merge([
            'slug' => $slug, 'name' => ucfirst($slug), 'description' => $slug,
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'is_active' => $active, 'sort_order' => 1,
        ], $overrides)));
    }

    private function runnerPreferring(array $slugs): RunnerProfile
    {
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        return RunnerProfile::create([
            'user_id' => $user->id, 'verification_status' => 'approved', 'is_online' => false,
            'preferred_types' => $slugs,
        ]);
    }

    private function migrate(string $direction = 'up'): void
    {
        $migration = require database_path(self::MIGRATION);
        $migration->{$direction}();
    }

    // ---------------------------------------------------------------------
    // Seeder
    // ---------------------------------------------------------------------

    public function test_a_fresh_install_gets_the_four_launch_types(): void
    {
        $this->seed(ErrandTypeSeeder::class);

        $types = ErrandType::orderBy('sort_order')->get();

        $this->assertSame(self::ACTIVE, $types->pluck('slug')->all());
        $this->assertSame(['Delivery', 'Buy for me', 'Queue / Pila', 'Custom errand'], $types->pluck('name')->all());
        $this->assertSame([1, 2, 3, 4], $types->pluck('sort_order')->all());
        $this->assertTrue($types->every(fn (ErrandType $t) => $t->is_active));
        $this->assertSame(
            'Parcels, documents or laundry — picked up and dropped off',
            $types->firstWhere('slug', 'delivery')->description,
        );
        $this->assertSame(
            'Groceries, food or anything you need — bought and brought to you',
            $types->firstWhere('slug', 'purchase')->description,
        );
    }

    public function test_a_redeploy_never_overwrites_what_staff_edited(): void
    {
        $this->seed(ErrandTypeSeeder::class);

        ErrandType::where('slug', 'delivery')->update(['base_fee' => 65.00, 'per_km_motorcycle' => 11.50, 'name' => 'Padala']);
        ErrandType::where('slug', 'custom')->update(['is_active' => false, 'sort_order' => 9]);

        // deploy.sh runs the seeder on every deploy.
        $this->seed(ErrandTypeSeeder::class);

        $delivery = ErrandType::where('slug', 'delivery')->first();
        $this->assertSame('65.00', $delivery->base_fee);
        $this->assertSame('11.50', $delivery->per_km_motorcycle);
        $this->assertSame('Padala', $delivery->name);

        $custom = ErrandType::where('slug', 'custom')->first();
        $this->assertFalse($custom->is_active);
        $this->assertSame(9, $custom->sort_order);

        $this->assertSame(4, ErrandType::count());
    }

    public function test_the_seeder_only_fills_in_a_missing_type(): void
    {
        $this->type('delivery', true, ['base_fee' => 99.00]);

        $this->seed(ErrandTypeSeeder::class);

        $this->assertSame(self::ACTIVE, ErrandType::orderBy('sort_order')->pluck('slug')->all());
        $this->assertSame('99.00', ErrandType::where('slug', 'delivery')->value('base_fee'));
    }

    // ---------------------------------------------------------------------
    // Migration
    // ---------------------------------------------------------------------

    public function test_the_migration_leaves_four_active_types_and_keeps_the_six_retired_rows(): void
    {
        $this->seedLegacyCatalog();
        ErrandType::where('slug', 'purchase')->update(['base_fee' => 85.00]);
        $bookedBefore = ErrandType::where('slug', 'laundry')->value('id');

        $this->migrate();

        $active = ErrandType::active()->ordered()->get();
        $this->assertSame(self::ACTIVE, $active->pluck('slug')->all());
        $this->assertSame(['Delivery', 'Buy for me', 'Queue / Pila', 'Custom errand'], $active->pluck('name')->all());
        $this->assertSame([1, 2, 3, 4], $active->pluck('sort_order')->all());
        $this->assertSame(
            'Parcels, documents or laundry — picked up and dropped off',
            $active->firstWhere('slug', 'delivery')->description,
        );
        $this->assertSame(
            'Groceries, food or anything you need — bought and brought to you',
            $active->firstWhere('slug', 'purchase')->description,
        );
        // Queue and custom keep the description they had.
        $this->assertSame('Have someone wait in line for you', $active->firstWhere('slug', 'queue')->description);
        $this->assertSame('Any other errand you need done', $active->firstWhere('slug', 'custom')->description);
        // Prices are not the migration's business.
        $this->assertSame('85.00', $active->firstWhere('slug', 'purchase')->base_fee);

        $retired = ErrandType::whereIn('slug', self::RETIRED)->get();
        $this->assertCount(6, $retired);
        $this->assertTrue($retired->every(fn (ErrandType $t) => ! $t->is_active));
        // Same row, so an older booking still resolves its type.
        $this->assertSame($bookedBefore, ErrandType::where('slug', 'laundry')->value('id'));

        // The deploy then runs the seeder: nothing is added or switched back on.
        $this->seed(ErrandTypeSeeder::class);
        $this->assertSame(10, ErrandType::count());
        $this->assertSame(4, ErrandType::active()->count());
    }

    public function test_the_migration_remaps_runners_preferred_types(): void
    {
        $this->seedLegacyCatalog();

        $delivery = $this->runnerPreferring(['document', 'laundry', 'delivery']);
        $shopper = $this->runnerPreferring(['food', 'grocery', 'queue']);
        $mixed = $this->runnerPreferring(['grocery', 'purchase', 'document']);
        $onlyRetired = $this->runnerPreferring(['bills_payment', 'transportation']);
        $untouched = $this->runnerPreferring(['custom', 'delivery']);
        $unset = $this->runnerPreferring([]);

        $this->migrate();

        $this->assertSame(['delivery'], $delivery->fresh()->preferred_types);
        $this->assertSame(['purchase', 'queue'], $shopper->fresh()->preferred_types);
        $this->assertSame(['purchase', 'delivery'], $mixed->fresh()->preferred_types);
        // An empty list blocks going online, so a runner whose every choice was
        // retired gets all four instead.
        $this->assertSame(self::ACTIVE, $onlyRetired->fresh()->preferred_types);
        $this->assertSame(['custom', 'delivery'], $untouched->fresh()->preferred_types);
        // A runner who never chose is not given choices they didn't make.
        $this->assertSame([], $unset->fresh()->preferred_types);
    }

    public function test_the_migration_drops_the_ride_only_settings(): void
    {
        $keys = ['ride_duration_alert_multiplier', 'route_deviation_threshold_meters', 'platform_fee_percent'];
        foreach ($keys as $key) {
            // platform_fee_percent already exists (every read setting is created on migrate).
            DB::table('system_config')->updateOrInsert(['key' => $key], ['value' => '1', 'description' => $key]);
        }

        $this->migrate();

        $this->assertSame(['platform_fee_percent'], DB::table('system_config')->whereIn('key', $keys)->pluck('key')->all());
    }

    public function test_the_app_sees_four_types_right_after_the_migration(): void
    {
        $this->seedLegacyCatalog();

        // Warm the cached catalog the way live traffic would before a deploy.
        $this->getJson('/api/v1/errand-types')->assertOk()->assertJsonCount(10, 'data');

        $this->migrate();

        $this->getJson('/api/v1/errand-types')
            ->assertOk()
            ->assertJsonCount(4, 'data')
            ->assertJsonPath('data.0.slug', 'delivery')
            ->assertJsonPath('data.1.name', 'Buy for me');
    }

    public function test_the_migration_reruns_safely_and_rolls_back_to_ten_active_types(): void
    {
        $this->seedLegacyCatalog();
        $runner = $this->runnerPreferring(['laundry']);

        $this->migrate();
        $this->migrate();

        $this->assertSame(4, ErrandType::active()->count());
        $this->assertSame(['delivery'], $runner->fresh()->preferred_types);

        $this->migrate('down');
        $this->assertSame(10, ErrandType::active()->count());

        $this->migrate();
        $this->assertSame(self::ACTIVE, ErrandType::active()->ordered()->pluck('slug')->all());
    }

    // ---------------------------------------------------------------------
    // Errands booked before the retirement still finish
    // ---------------------------------------------------------------------

    /**
     * @return array{0: Booking, 1: User}
     */
    private function legacyErrand(string $slug, array $overrides = []): array
    {
        $type = $this->type($slug, active: false);
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 0]);
        RunnerProfile::create([
            'user_id' => $runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'preferred_types' => [$slug], 'total_errands' => 0, 'total_earnings' => 0.00,
        ]);

        $booking = Booking::create(array_merge([
            'booking_number' => 'EG-20261030-'.strtoupper(substr(md5($slug), 0, 6)),
            'customer_id' => $customer->id, 'runner_id' => $runner->id,
            'errand_type_id' => $type->id, 'status' => 'accepted',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 100,
            'payment_method' => 'wallet', 'payment_status' => 'paid',
        ], $overrides));

        return [$booking, $runner];
    }

    private function advance(User $runner, Booking $booking, string $status, array $extra = []): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($runner)
            ->postJson("/api/v1/runner/errand/{$booking->id}/status", ['status' => $status, ...$extra]);
    }

    public function test_a_ride_in_progress_at_deploy_finishes_along_the_delivery_steps(): void
    {
        Event::fake();
        Storage::fake('media');

        [$ride, $runner] = $this->legacyErrand('transportation', [
            'is_transportation' => true, 'ride_pin' => '4821', 'ride_pin_verified' => false,
        ]);

        foreach (['heading_to_pickup', 'arrived_at_pickup'] as $status) {
            $this->advance($runner, $ride, $status)->assertOk();
        }
        // No PIN gate any more: the unverified PIN does not hold the ride.
        $this->advance($runner, $ride, 'picked_up', ['pickup_photo' => UploadedFile::fake()->image('p.jpg')])->assertOk();
        $this->advance($runner, $ride, 'in_transit')->assertOk();
        $this->advance($runner, $ride, 'arrived_at_dropoff')->assertOk();

        // The old ride shortcut (arrived_at_dropoff → completed) is gone…
        $this->advance($runner, $ride, 'completed')->assertStatus(422);

        // …and the ordinary handover + completion finish it.
        $this->advance($runner, $ride, 'delivered', ['delivery_photo' => UploadedFile::fake()->image('d.jpg')])->assertOk();
        $this->advance($runner, $ride, 'completed', ['signature' => UploadedFile::fake()->image('s.png')])
            ->assertOk()
            ->assertJsonPath('data.status', 'completed');

        $ride->refresh();
        $this->assertSame('completed', $ride->status);
        $this->assertNotNull($ride->completed_at);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $runner->id, 'type' => 'earning', 'reference_id' => $ride->id,
        ]);
    }

    public function test_a_legacy_grocery_errand_still_shops_against_a_receipt(): void
    {
        Event::fake();
        Storage::fake('media');

        [$booking, $runner] = $this->legacyErrand('grocery', ['shopping_budget' => 1000]);

        $this->advance($runner, $booking, 'heading_to_pickup')->assertOk();
        $this->advance($runner, $booking, 'arrived_at_pickup')->assertOk();
        // Shopping flow: the receipt + actual cost is the pickup proof.
        $this->advance($runner, $booking, 'picked_up')->assertStatus(422)
            ->assertJsonValidationErrors(['receipt_photo', 'actual_item_cost']);
        $this->advance($runner, $booking, 'picked_up', [
            'actual_item_cost' => 640,
            'receipt_photo' => UploadedFile::fake()->image('receipt.jpg'),
        ])->assertOk();

        $this->assertSame('640.00', $booking->fresh()->actual_item_cost);
    }

    public function test_a_legacy_bills_payment_errand_still_ends_at_the_counter(): void
    {
        Event::fake();
        Storage::fake('media');

        [$booking, $runner] = $this->legacyErrand('bills_payment', [
            'shopping_budget' => 2500,
            'dropoff_address' => '123 Main', 'dropoff_lat' => 14.60, 'dropoff_lng' => 120.98,
        ]);

        $this->advance($runner, $booking, 'heading_to_pickup')->assertOk();
        $this->advance($runner, $booking, 'arrived_at_pickup')->assertOk();
        $this->advance($runner, $booking, 'picked_up', [
            'actual_item_cost' => 2310,
            'receipt_photo' => UploadedFile::fake()->image('receipt.jpg'),
        ])->assertOk();

        // Single-location: no transit leg, and it completes without a signature.
        $this->advance($runner, $booking, 'in_transit')->assertStatus(422);
        $this->advance($runner, $booking, 'completed')->assertOk();

        $this->assertSame('completed', $booking->fresh()->status);
    }

    // ---------------------------------------------------------------------
    // Admin guards
    // ---------------------------------------------------------------------

    public function test_rides_and_bills_can_never_be_switched_back_on(): void
    {
        $ride = $this->type('transportation', false);
        $bills = $this->type('bills_payment', false);

        $ride->update(['is_active' => true]);
        $bills->update(['is_active' => true]);

        $this->assertFalse($ride->fresh()->is_active);
        $this->assertFalse($bills->fresh()->is_active);

        // A merged type with a successor is a normal row: staff may still use it.
        $food = $this->type('food', false);
        $food->update(['is_active' => true]);
        $this->assertTrue($food->fresh()->is_active);
    }

    public function test_a_staff_edit_reaches_the_app_without_waiting_for_the_cache(): void
    {
        $this->seed(ErrandTypeSeeder::class);
        Cache::put(CacheService::errandTypesKey(), ['stale'], 3600);

        ErrandType::where('slug', 'delivery')->first()->update(['base_fee' => 70.00]);

        $this->assertFalse(Cache::has(CacheService::errandTypesKey()));
    }
}
