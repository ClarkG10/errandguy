<?php

namespace Tests\Feature\Admin;

use App\Filament\Widgets\OperationsKpis;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use App\Services\BookingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * "Operations health" must tell a runner shortage apart from customers
 * cancelling: an errand nobody took is auto-cancelled after its search (so it
 * ends 'cancelled', not 'no_runner'), and an unpaid GCash/Maya checkout is
 * cancelled too. Neither is a customer cancellation.
 */
class OperationsKpisTest extends TestCase
{
    use RefreshDatabase;

    private int $n = 0;

    private function booking(string $status, array $overrides = []): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::firstOrCreate(['slug' => 'delivery'], [
            'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);

        Booking::create(array_merge([
            'booking_number' => 'EG-KPI-'.(++$this->n),
            'customer_id' => $customer->id, 'errand_type_id' => $type->id,
            'status' => $status, 'payment_status' => 'unpaid',
            'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 100, 'is_transportation' => false,
        ], $overrides));
    }

    public function test_no_runner_cancellations_and_dropped_checkouts_are_counted_apart(): void
    {
        Cache::flush();
        $this->actingAs(AdminUser::forceCreate([
            'email' => 'ops@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops', 'role' => 'ops', 'is_active' => true,
        ]), 'admin');

        $this->booking('completed');
        $this->booking('cancelled', ['cancellation_reason' => 'Changed my mind']);
        $this->booking('cancelled', ['cancellation_reason' => 'Auto-cancelled: no runner found within timeout.']);
        $this->booking('cancelled', [
            'cancellation_reason' => 'Payment not completed',
            'cancellation_code' => BookingService::PAYMENT_NOT_COMPLETED_CODE,
        ]);

        Livewire::test(OperationsKpis::class)
            ->assertSee('1 cancelled · 1 unpaid checkouts dropped')
            ->assertSee('1 went unmatched')
            ->assertSee('25.0%');
    }
}
