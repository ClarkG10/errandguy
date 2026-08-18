<?php

namespace Tests\Feature\Admin;

use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * /admin/dashboard/stats bookings.active must exclude no_runner (a terminal,
 * already-refunded/awaiting-auto-cancel state) to match the canonical "active
 * bookings" definition used in every other surface (the Filament dashboard card,
 * BookingListStats, ActionQueue-as-"stuck", etc.). Previously it only excluded
 * completed + cancelled, so no_runner errands inflated the API's active figure.
 */
class DashboardActiveCountTest extends TestCase
{
    use RefreshDatabase;

    public function test_dashboard_active_bookings_excludes_no_runner(): void
    {
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);

        $i = 0;
        foreach (['accepted', 'no_runner', 'completed', 'cancelled'] as $status) {
            Booking::create([
                'booking_number' => 'EG-20260331-AC'.($i++),
                'customer_id' => $customer->id, 'errand_type_id' => $type->id, 'status' => $status,
                'pickup_address' => 'a', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98,
                'dropoff_address' => 'b', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
                'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
                'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
                'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
            ]);
        }

        $admin = AdminUser::create([
            'email' => 'sa@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Super', 'role' => AdminUser::ROLE_SUPER_ADMIN, 'is_active' => true,
        ]);
        Sanctum::actingAs($admin);

        // Only 'accepted' is genuinely active — not no_runner/completed/cancelled.
        $this->getJson('/api/v1/admin/dashboard/stats')
            ->assertOk()
            ->assertJsonPath('data.bookings.active', 1);
    }
}
