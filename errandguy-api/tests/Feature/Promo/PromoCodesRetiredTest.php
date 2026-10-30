<?php

namespace Tests\Feature\Promo;

use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Promo codes are retired for launch. The codes, their per-user redemption
 * rows and the two booking columns only the redemption engine used are gone,
 * but bookings.promo_discount stays: it is historical money data, so an older
 * booking that used a promo still shows (and settles) its discount.
 */
class PromoCodesRetiredTest extends TestCase
{
    use RefreshDatabase;

    private const MIGRATION = 'migrations/2026_10_23_000001_drop_promo_codes.php';

    private function assertPromoSchemaIsGone(): void
    {
        $this->assertFalse(Schema::hasTable('promo_codes'));
        $this->assertFalse(Schema::hasTable('promo_user_redemptions'));
        $this->assertFalse(Schema::hasColumn('bookings', 'promo_code_id'));
        $this->assertFalse(Schema::hasColumn('bookings', 'promo_redeemed'));
        $this->assertTrue(Schema::hasColumn('bookings', 'promo_discount'));
    }

    private function booking(User $customer, float $promoDiscount): Booking
    {
        $type = ErrandType::firstOrCreate(['slug' => 'delivery'], [
            'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18,
            'is_active' => true, 'sort_order' => 1,
        ]);

        // Fare 115 before the discount; the customer paid 115 − discount.
        return Booking::create([
            'booking_number' => 'EG-20261023-'.strtoupper(substr(md5((string) $promoDiscount), 0, 6)),
            'customer_id' => $customer->id,
            'errand_type_id' => $type->id,
            'status' => 'completed',
            'payment_method' => 'wallet', 'payment_status' => 'paid',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'promo_discount' => $promoDiscount,
            'total_amount' => 115 - $promoDiscount, 'runner_payout' => 100,
            'is_transportation' => false, 'completed_at' => now(),
        ]);
    }

    private function actAsAdmin(): void
    {
        $admin = AdminUser::forceCreate([
            'email' => 'super@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Super Admin', 'role' => AdminUser::ROLE_SUPER_ADMIN, 'is_active' => true,
            'has_email_authentication' => true, // two-step sign-in set up
        ]);
        $this->actingAs($admin, 'admin');
    }

    public function test_the_promo_tables_and_columns_are_gone_but_promo_discount_stays(): void
    {
        $this->assertPromoSchemaIsGone();
    }

    public function test_the_migration_reruns_safely_and_rolls_back_to_the_old_structure(): void
    {
        $migration = require database_path(self::MIGRATION);

        $migration->down();

        $this->assertTrue(Schema::hasTable('promo_codes'));
        $this->assertTrue(Schema::hasTable('promo_user_redemptions'));
        $this->assertTrue(Schema::hasColumn('bookings', 'promo_code_id'));
        $this->assertTrue(Schema::hasColumn('bookings', 'promo_redeemed'));

        // SQLite refuses to drop an indexed column (MySQL's foreign key leaves
        // one behind on promo_code_id), so up() must clear the index first.
        Schema::table('bookings', function (Blueprint $table) {
            $table->index('promo_code_id');
        });

        $migration->up();
        $this->assertPromoSchemaIsGone();

        // Running it again over an already-clean schema is a no-op, not an error.
        $migration->up();
        $this->assertPromoSchemaIsGone();
    }

    public function test_the_promo_endpoints_and_admin_pages_are_gone(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->actingAs($customer)->getJson('/api/v1/promos')->assertNotFound();
        $this->actingAs($customer)->getJson('/api/v1/promos/validate/SAVE10')->assertNotFound();

        $this->actAsAdmin();
        $this->get('/admin/promo-codes')->assertNotFound();
    }

    public function test_an_older_booking_keeps_its_promo_discount_on_the_api(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $booking = $this->booking($customer, 10);

        $this->actingAs($customer)
            ->getJson("/api/v1/bookings/{$booking->id}")
            ->assertOk()
            ->assertJsonPath('data.promo_discount', '10.00')
            ->assertJsonPath('data.total_amount', '105.00');
    }

    public function test_the_admin_booking_page_shows_a_past_promo_discount_only_when_there_is_one(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $withDiscount = $this->booking($customer, 10);
        $withoutDiscount = $this->booking($customer, 0);

        $this->actAsAdmin();

        $this->get("/admin/bookings/{$withDiscount->id}/view")
            ->assertOk()
            ->assertSee('Past promo code discount');

        $this->get("/admin/bookings/{$withoutDiscount->id}/view")
            ->assertOk()
            ->assertDontSee('Past promo code discount');
    }
}
