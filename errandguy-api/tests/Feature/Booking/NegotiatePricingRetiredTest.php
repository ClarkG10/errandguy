<?php

namespace Tests\Feature\Booking;

use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\SystemConfig;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * "Name your price" (negotiate mode) is retired: every errand is fixed price.
 * Its settings, the per-type offer floor and the leftover broadcast offer cards
 * are gone; bookings.pricing_mode / customer_offer / negotiate_expires_at stay
 * as history, so an older negotiate booking still shows the price it was sold
 * at.
 */
class NegotiatePricingRetiredTest extends TestCase
{
    use RefreshDatabase;

    private const MIGRATION = 'migrations/2026_10_31_000002_retire_negotiate_pricing.php';

    private const BOOKKEEPING_MIGRATION = 'migrations/2026_10_31_000001_add_matching_bookkeeping_to_bookings.php';

    private function assertRetired(): void
    {
        $this->assertFalse(Schema::hasColumn('errand_types', 'min_negotiate_fee'));
        $this->assertFalse(SystemConfig::whereIn('key', ['negotiate_timeout_minutes', 'max_negotiate_timeout_minutes'])->exists());
        $this->assertSame(0, Notification::where('type', 'incoming_request')->count());

        foreach (['pricing_mode', 'customer_offer', 'negotiate_expires_at'] as $history) {
            $this->assertTrue(Schema::hasColumn('bookings', $history), "bookings.{$history} is history and must stay");
        }
    }

    public function test_the_negotiate_schema_and_settings_are_gone_but_booking_history_stays(): void
    {
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        $this->seed(\Database\Seeders\ErrandTypeSeeder::class);

        $this->assertRetired();
        $this->assertGreaterThan(0, ErrandType::count(), 'the seeder still creates the catalog without the dropped column');
    }

    public function test_the_migration_reruns_safely_and_rolls_back_to_the_old_structure(): void
    {
        $migration = require database_path(self::MIGRATION);
        $migration->down();

        $this->assertTrue(Schema::hasColumn('errand_types', 'min_negotiate_fee'));
        $this->assertTrue(SystemConfig::whereKey('negotiate_timeout_minutes')->exists());

        // Leftover offer cards a runner can no longer act on — plus a normal
        // notification that must survive.
        $runner = User::factory()->create(['role' => 'runner']);
        DB::table('notifications')->insert([
            ['id' => (string) \Illuminate\Support\Str::uuid(), 'user_id' => $runner->id, 'title' => 'New errand request',
                'body' => 'x', 'type' => 'incoming_request', 'data' => '{}', 'is_read' => false, 'created_at' => now()],
            ['id' => (string) \Illuminate\Support\Str::uuid(), 'user_id' => $runner->id, 'title' => 'Errand completed',
                'body' => 'x', 'type' => 'booking_update', 'data' => '{}', 'is_read' => false, 'created_at' => now()],
        ]);
        // SQLite refuses to drop an indexed column, so up() must clear it first.
        Schema::table('errand_types', fn ($table) => $table->index('min_negotiate_fee'));

        $migration->up();
        $this->assertRetired();
        $this->assertSame(1, Notification::where('user_id', $runner->id)->count());

        // Running it again over an already-clean schema is a no-op, not an error.
        $migration->up();
        $this->assertRetired();
    }

    public function test_the_matching_bookkeeping_migration_reruns_safely_and_rolls_back(): void
    {
        $migration = require database_path(self::BOOKKEEPING_MIGRATION);
        $columns = ['offered_runner_ids', 'offer_count', 'matching_started_at'];

        $migration->up(); // already applied: a no-op
        foreach ($columns as $column) {
            $this->assertTrue(Schema::hasColumn('bookings', $column));
        }

        $migration->down();
        foreach ($columns as $column) {
            $this->assertFalse(Schema::hasColumn('bookings', $column));
        }

        $migration->up();
        foreach ($columns as $column) {
            $this->assertTrue(Schema::hasColumn('bookings', $column));
        }
    }

    public function test_the_catalog_and_estimate_no_longer_carry_negotiate_fields(): void
    {
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        $this->seed(\Database\Seeders\ErrandTypeSeeder::class);
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $delivery = ErrandType::where('slug', 'delivery')->firstOrFail();

        $catalog = $this->getJson('/api/v1/errand-types')->assertOk()->json('data');
        $this->assertArrayNotHasKey('min_negotiate_fee', $catalog[0]);

        $estimate = $this->actingAs($customer)->postJson('/api/v1/bookings/estimate', [
            'errand_type_id' => $delivery->id,
            'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
        ])->assertOk()->json('data');
        foreach (['min_negotiate_fee', 'recommended_min', 'recommended_max'] as $retired) {
            $this->assertArrayNotHasKey($retired, $estimate);
        }
    }

    public function test_an_older_negotiate_booking_still_shows_the_price_it_was_sold_at(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
        $booking = Booking::create([
            'booking_number' => 'EG-20261001-NEGO01', 'customer_id' => $customer->id,
            'errand_type_id' => $type->id, 'status' => 'completed', 'completed_at' => now(),
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'negotiate', 'customer_offer' => 200,
            'vehicle_type_rate' => 'motorcycle', 'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50,
            'service_fee' => 15, 'surcharge' => 0, 'total_amount' => 200, 'runner_payout' => 185,
            'payment_method' => 'wallet', 'payment_status' => 'paid', 'is_transportation' => false,
        ]);

        $this->actingAs($customer)->getJson("/api/v1/bookings/{$booking->id}")
            ->assertOk()
            ->assertJsonPath('data.pricing_mode', 'negotiate')
            ->assertJsonPath('data.customer_offer', '200.00')
            ->assertJsonPath('data.total_amount', '200.00');
    }

    public function test_the_admin_errand_type_pages_render_without_the_offer_floor(): void
    {
        $this->seed(\Database\Seeders\ErrandTypeSeeder::class);
        $this->actingAs(AdminUser::create([
            'email' => 'super@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Super', 'role' => AdminUser::ROLE_SUPER_ADMIN, 'is_active' => true,
        ]), 'admin');
        $delivery = ErrandType::where('slug', 'delivery')->firstOrFail();

        $this->get('/admin/errand-types')->assertOk()->assertDontSee('Min negotiate');
        $this->get("/admin/errand-types/{$delivery->id}/edit")->assertOk()->assertDontSee('negotiate');
    }
}
