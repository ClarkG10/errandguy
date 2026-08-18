<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\Users\RelationManagers\WalletTransactionsRelationManager;
use App\Models\AdminUser;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The Users > "Wallet history" relation-manager tab exposes the same financial
 * ledger (amounts, running balance, payout/payment/refund descriptions) that
 * WalletTransactionResource gates behind canManageMoney(). Without its own
 * canViewForRecord() gate — and because Gate::before blanket-allows every
 * ability for any AdminUser — a support/ops/admin role that is 403'd from
 * /admin/wallet-transactions could still read any user's ledger through this
 * tab. The gate must mirror the money boundary.
 */
class WalletLedgerRelationManagerAuthzTest extends TestCase
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

    public function test_wallet_ledger_tab_is_gated_to_money_admins(): void
    {
        $owner = User::factory()->create();

        // canManageMoney() = super_admin | finance only. Everyone else is denied.
        foreach (['support', 'ops', 'admin'] as $role) {
            $this->actingAs($this->admin($role), 'admin');
            $this->assertFalse(
                WalletTransactionsRelationManager::canViewForRecord($owner, 'view'),
                "role {$role} must NOT see the wallet ledger tab",
            );
        }

        foreach (['finance', 'super_admin'] as $role) {
            $this->actingAs($this->admin($role), 'admin');
            $this->assertTrue(
                WalletTransactionsRelationManager::canViewForRecord($owner, 'view'),
                "role {$role} manages money and may see the wallet ledger tab",
            );
        }
    }
}
