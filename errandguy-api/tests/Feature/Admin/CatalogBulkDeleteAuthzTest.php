<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\ErrandTypes\ErrandTypeResource;
use App\Filament\Resources\ErrandTypes\Pages\EditErrandType;
use App\Filament\Resources\ErrandTypes\Pages\ListErrandTypes;
use App\Models\AdminUser;
use App\Models\ErrandType;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Spatie\Activitylog\Models\Activity;
use Tests\TestCase;

/**
 * The errand catalog is a fixed set of types, each with its own flow in the
 * app. Staff edit prices, copy and the on/off switch; no role can add a type
 * (a new slug has no flow behind it), delete one (bookings reference it) or
 * rename a slug (the app and runners' preferences depend on it). Every edit is
 * written to the audit log with the old and new values.
 *
 * Bulk delete used to be the hole: Filament authorizes it through the
 * 'deleteAny' policy path, which the AdminUser Gate::before allows for every
 * staff role. (audit v5 authz)
 */
class CatalogBulkDeleteAuthzTest extends TestCase
{
    use RefreshDatabase;

    private function admin(string $role): AdminUser
    {
        return AdminUser::create([
            'email' => $role.'@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => ucfirst($role), 'role' => $role, 'is_active' => true,
        ]);
    }

    private function type(string $slug, bool $active = true): ErrandType
    {
        return ErrandType::create([
            'slug' => $slug, 'name' => ucfirst($slug), 'description' => 'x', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'is_active' => $active, 'sort_order' => 1,
        ]);
    }

    public function test_no_role_can_bulk_delete_errand_types(): void
    {
        foreach (['support', 'admin', 'super_admin'] as $role) {
            $this->actingAs($this->admin($role), 'admin');
            Livewire::test(ListErrandTypes::class)->assertTableBulkActionDoesNotExist('delete');
        }
    }

    public function test_no_role_can_create_or_delete_a_type(): void
    {
        $this->actingAs($this->admin('super_admin'), 'admin');
        $type = $this->type('delivery');

        $this->assertFalse(ErrandTypeResource::canCreate());
        $this->assertFalse(ErrandTypeResource::canDelete($type));
        $this->assertFalse(ErrandTypeResource::canDeleteAny());
        $this->assertArrayNotHasKey('create', ErrandTypeResource::getPages());
        Livewire::test(EditErrandType::class, ['record' => $type->getRouteKey()])
            ->assertActionDoesNotExist('delete');
    }

    public function test_a_price_change_is_audited_and_the_slug_is_fixed(): void
    {
        $this->actingAs($this->admin('admin'), 'admin');
        $type = $this->type('delivery');

        Livewire::test(EditErrandType::class, ['record' => $type->getRouteKey()])
            ->fillForm(['base_fee' => 65, 'slug' => 'renamed'])
            ->call('save')
            ->assertHasNoFormErrors();

        $type->refresh();
        $this->assertSame('delivery', $type->slug);
        $this->assertEquals(65, (float) $type->base_fee);

        $log = Activity::where('event', 'catalog.updated')->sole();
        $this->assertEquals(50, (float) $log->properties['old']['base_fee']);
        $this->assertEquals(65, (float) $log->properties['new']['base_fee']);
        $this->assertSame('delivery', $log->properties['slug']);
    }
}
