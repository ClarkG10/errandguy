<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\ErrandTypes\Pages\CreateErrandType;
use App\Models\AdminUser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * Admin pricing form fields feed PricingService, which does not clamp a negative
 * total. A negative fee is therefore a standing misconfiguration that silently
 * under- or over-charges. The forms now reject it at the source with
 * minValue(0). They also cap the upper end with maxValue: an absurd rate (a
 * fat-fingered extra zero) would otherwise overcharge every customer, and a value
 * past the decimal column ceiling would 500 the save under strict MySQL.
 * (Filament-internals sweep)
 */
class AdminPricingFormValidationTest extends TestCase
{
    use RefreshDatabase;

    private function actAsCatalogAdmin(): void
    {
        $admin = AdminUser::create([
            'email' => 'sa@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Super', 'role' => AdminUser::ROLE_SUPER_ADMIN, 'is_active' => true,
        ]);
        $this->actingAs($admin, 'admin');
    }

    public function test_errand_type_form_rejects_a_negative_fee(): void
    {
        $this->actAsCatalogAdmin();

        Livewire::test(CreateErrandType::class)
            ->fillForm(['name' => 'Test Type', 'slug' => 'test-type', 'base_fee' => 50, 'per_km_car' => -10])
            ->call('create')
            ->assertHasFormErrors(['per_km_car']);
    }

    public function test_errand_type_form_rejects_an_out_of_range_fee(): void
    {
        $this->actAsCatalogAdmin();

        // per_km_car is decimal(6,2) (ceiling 9999.99); a fat-fingered rate both
        // overcharges every customer and overflows the column on strict MySQL.
        Livewire::test(CreateErrandType::class)
            ->fillForm(['name' => 'Test Type', 'slug' => 'test-type', 'base_fee' => 50, 'per_km_car' => 99999])
            ->call('create')
            ->assertHasFormErrors(['per_km_car']);
    }
}
