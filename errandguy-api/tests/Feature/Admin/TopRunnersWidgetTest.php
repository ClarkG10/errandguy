<?php

namespace Tests\Feature\Admin;

use App\Filament\Widgets\TopRunners;
use App\Models\AdminUser;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * TopRunners computes each row's rank badge with a window function in the single
 * list query (row_number() over (order by total_earnings desc)) instead of one
 * COUNT(*) per rendered row. This renders the widget with real data to prove the
 * window-function query executes (MySQL 8 + SQLite 3.25+) and the rows show.
 */
class TopRunnersWidgetTest extends TestCase
{
    use RefreshDatabase;

    public function test_top_runners_widget_renders_via_window_function_rank(): void
    {
        $admin = AdminUser::create([
            'email' => 'sa@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Super', 'role' => AdminUser::ROLE_SUPER_ADMIN, 'is_active' => true,
        ]);
        $this->actingAs($admin, 'admin');

        foreach ([['A', 300], ['B', 200], ['C', 100]] as [$suffix, $earnings]) {
            $u = User::factory()->create(['role' => 'runner', 'status' => 'active', 'full_name' => "Runner {$suffix}"]);
            RunnerProfile::create([
                'user_id' => $u->id, 'verification_status' => 'approved', 'is_online' => true,
                'preferred_types' => [], 'acceptance_rate' => 100.00, 'completion_rate' => 100.00,
                'total_errands' => 5, 'total_earnings' => $earnings,
            ]);
        }

        Livewire::test(TopRunners::class)
            ->assertSuccessful()
            ->assertSee('Runner A')
            ->assertSee('Runner C');
    }
}
