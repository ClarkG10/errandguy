<?php

namespace Tests\Feature\Admin;

use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Admin queues gate real people: a stranded errand is a customer with no
 * runner. Two frictions fixed here — work queues sorted newest-first (so the
 * longest-waiting person sat on the last page) and re-running matching being a
 * per-row modal.
 */
class AdminQueueTriageTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $admin = AdminUser::create([
            'email' => 'ops@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops', 'role' => 'admin', 'is_active' => true,
        ]);
        $this->actingAs($admin, 'admin');
    }

    private function seedBooking(string $status, $createdAt): Booking
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::firstOrCreate(['slug' => 'delivery'], [
            'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18,
            'is_active' => true, 'sort_order' => 1,
        ]);
        $b = Booking::create([
            'booking_number' => 'EG-Q-'.uniqid(),
            'customer_id' => $customer->id, 'errand_type_id' => $type->id, 'status' => $status,
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);

        $b->forceFill(['created_at' => $createdAt])->save();

        return $b;
    }

    public function test_bookings_list_renders_with_the_bulk_rematch_action(): void
    {
        $this->seedBooking('no_runner', now()->subHours(3));

        // A Filament toolbar action that fails to build takes the whole page
        // down, so a server-side render is the smoke test.
        $this->get('/admin/bookings')
            ->assertOk()
            ->assertSee('Re-run matching for selected');
    }
}
