<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\ActivityLogs\Pages\ListActivityLogs;
use App\Models\AdminUser;
use App\Models\SystemConfig;
use App\Models\User;
use App\Support\AdminActivity;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Spatie\Activitylog\Models\Activity;
use Tests\TestCase;

/**
 * The audit log answers "who did what to which errand/person" in staff words:
 * the subject reads as a name or number, not a UUID prefix, and the list can
 * be narrowed to one staff member.
 */
class AuditLogReadabilityTest extends TestCase
{
    use RefreshDatabase;

    private function staff(string $email, string $name): AdminUser
    {
        return AdminUser::forceCreate([
            'email' => $email, 'password_hash' => Hash::make('Password1!'),
            'full_name' => $name, 'role' => 'super_admin', 'is_active' => true,
        ]);
    }

    public function test_subjects_read_as_names_and_the_list_filters_by_staff(): void
    {
        $ana = $this->staff('ana@errandguy.test', 'Ana Admin');
        $ben = $this->staff('ben@errandguy.test', 'Ben Boss');
        $user = User::factory()->create(['role' => 'customer', 'full_name' => 'Juan Cruz']);
        $setting = SystemConfig::updateOrCreate(['key' => 'matching_radius_km'], ['value' => '10']);

        $this->actingAs($ana, 'admin');
        AdminActivity::log('user.suspended', $user, [], 'Suspended a user');
        $this->actingAs($ben, 'admin');
        AdminActivity::log('setting.changed', $setting, [], 'Changed a setting');

        $byAna = Activity::where('causer_id', $ana->id)->sole();
        $byBen = Activity::where('causer_id', $ben->id)->sole();

        Livewire::test(ListActivityLogs::class)
            ->assertTableColumnStateSet('subject_label', 'Juan Cruz', $byAna)
            ->assertTableColumnStateSet('subject_label', 'Setting matching_radius_km', $byBen)
            ->filterTable('causer_id', $ana->id)
            ->assertCanSeeTableRecords([$byAna])
            ->assertCanNotSeeTableRecords([$byBen]);

        $user->forceDelete();
        Livewire::test(ListActivityLogs::class)
            ->assertTableColumnStateSet('subject_label', 'User #'.substr($user->id, 0, 8).' (deleted)', $byAna);
    }
}
