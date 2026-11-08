<?php

namespace Tests\Feature\Booking;

use App\Filament\Resources\Bookings\Pages\ViewBooking;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use App\Services\PricingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * A fare's rows must add up to its total.
 *
 * PricingService adds a flat premium for the vehicle (motorcycle 25, car 60)
 * that the booking never stored, so a motorcycle errand's receipt and the staff
 * "Fee breakdown" read Base 50 + Distance 6.45 + Convenience 12.22 = 68.67
 * under a 93.67 total. Booking::vehiclePremium() recovers it.
 */
class FareAddsUpTest extends TestCase
{
    use RefreshDatabase;

    private ErrandType $type;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50, 'surcharge' => 5, 'per_km_walk' => 15,
            'per_km_bicycle' => 12, 'per_km_motorcycle' => 10, 'per_km_car' => 18,
            'is_active' => true, 'sort_order' => 1,
        ]);
    }

    /** Stores a booking the way BookingController::store does. */
    private function booked(string $vehicle, array $overrides = []): Booking
    {
        $pricing = app(PricingService::class)->calculate($this->type->id, 14.60, 120.98, 14.55, 121.02, $vehicle);

        return Booking::create(array_merge([
            'booking_number' => 'EG-FARE-'.strtoupper(substr(md5(uniqid('', true)), 0, 6)),
            'customer_id' => $this->customer->id, 'errand_type_id' => $this->type->id,
            'status' => 'pending',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => $vehicle,
            'distance_km' => $pricing['distance_km'], 'base_fee' => $pricing['base_fee'],
            'distance_fee' => $pricing['distance_fee'], 'service_fee' => $pricing['service_fee'],
            'surcharge' => $pricing['surcharge'], 'promo_discount' => 0,
            'total_amount' => $pricing['total_amount'], 'runner_payout' => $pricing['runner_payout'],
            'payment_method' => 'cash', 'payment_status' => 'unpaid', 'is_transportation' => false,
        ], $overrides));
    }

    public function test_the_recovered_premium_is_the_one_the_fare_was_priced_with(): void
    {
        foreach (['walk' => 0.0, 'bicycle' => 10.0, 'motorcycle' => 25.0, 'car' => 60.0] as $vehicle => $premium) {
            $booking = $this->booked($vehicle);

            $this->assertSame($premium, $booking->fresh()->vehiclePremium(), $vehicle);
            $rows = (float) $booking->base_fee + $premium + (float) $booking->distance_fee
                + (float) $booking->service_fee + (float) $booking->surcharge;
            $this->assertEqualsWithDelta((float) $booking->total_amount, $rows, 0.001, $vehicle);
        }
    }

    public function test_rows_it_cannot_explain_get_no_vehicle_fee(): void
    {
        $this->assertNull($this->booked('car', ['pricing_mode' => 'negotiate'])->vehiclePremium());
        $this->assertNull($this->booked('car', ['total_amount' => 10])->vehiclePremium());
    }

    public function test_staff_see_the_vehicle_fee_in_the_breakdown(): void
    {
        $this->actingAs(AdminUser::create([
            'email' => 'ops@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops', 'role' => AdminUser::ROLE_OPS, 'is_active' => true,
        ]), 'admin');
        $booking = $this->booked('motorcycle');

        Livewire::test(ViewBooking::class, ['record' => $booking->getRouteKey()])
            ->assertOk()
            ->assertSee('Vehicle fee')
            ->assertSee('25.00');
    }
}
