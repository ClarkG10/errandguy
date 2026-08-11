<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\ErrandTypes\Pages\ListErrandTypes;
use App\Filament\Resources\PromoCodes\Pages\ListPromoCodes;
use App\Models\AdminUser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * The list-page bulk-delete on catalog/promo resources must be gated to
 * super_admin/admin (the resources' own canManageCatalog / canMutate). Filament
 * authorizes a list bulk-delete via the 'deleteAny' policy path, which — with no
 * model policy — falls through the AdminUser Gate::before to ALLOW for EVERY
 * admin role, bypassing the resource canDelete() override. Without the explicit
 * ->visible() gate, support/ops/finance could wipe the pricing catalog / promo
 * codes. (audit v5 authz)
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

    public function test_support_admin_cannot_bulk_delete_errand_types(): void
    {
        $this->actingAs($this->admin('support'), 'admin');
        Livewire::test(ListErrandTypes::class)->assertTableBulkActionHidden('delete');
    }

    public function test_admin_can_bulk_delete_errand_types(): void
    {
        $this->actingAs($this->admin('admin'), 'admin');
        Livewire::test(ListErrandTypes::class)->assertTableBulkActionVisible('delete');
    }

    public function test_finance_admin_cannot_bulk_delete_promo_codes(): void
    {
        $this->actingAs($this->admin('finance'), 'admin');
        Livewire::test(ListPromoCodes::class)->assertTableBulkActionHidden('delete');
    }

    public function test_admin_can_bulk_delete_promo_codes(): void
    {
        $this->actingAs($this->admin('admin'), 'admin');
        Livewire::test(ListPromoCodes::class)->assertTableBulkActionVisible('delete');
    }
}
