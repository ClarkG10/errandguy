<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\Reviews\Pages\ListReviews;
use App\Models\AdminUser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * Review moderation (flag / unflag) is a moderation surface and must be gated to
 * moderators (super_admin / admin / ops) via canModerate(). Filament actions have
 * no policy fall-through, so without the explicit ->visible() gate the
 * Gate::before blanket-allow let finance/support moderate review flags. Mirrors
 * the existing delete-action gates in the same table. (audit 2026-08-17 H-E)
 */
class ReviewModerationAuthzTest extends TestCase
{
    use RefreshDatabase;

    private function admin(string $role): AdminUser
    {
        return AdminUser::create([
            'email' => $role.'@errandguy.test',
            'password_hash' => Hash::make('Password1!'),
            'full_name' => ucfirst($role),
            'role' => $role,
            'is_active' => true,
        ]);
    }

    public function test_non_moderator_roles_cannot_bulk_unflag(): void
    {
        foreach ([AdminUser::ROLE_FINANCE, AdminUser::ROLE_SUPPORT] as $role) {
            $this->actingAs($this->admin($role), 'admin');
            Livewire::test(ListReviews::class)->assertTableBulkActionHidden('unflagSelected');
        }
    }

    public function test_moderator_roles_can_bulk_unflag(): void
    {
        foreach ([AdminUser::ROLE_SUPER_ADMIN, AdminUser::ROLE_ADMIN, AdminUser::ROLE_OPS] as $role) {
            $this->actingAs($this->admin($role), 'admin');
            Livewire::test(ListReviews::class)->assertTableBulkActionVisible('unflagSelected');
        }
    }
}
