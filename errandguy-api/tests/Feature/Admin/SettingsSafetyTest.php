<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\SystemConfigs\Pages\EditSystemConfig;
use App\Filament\Resources\SystemConfigs\SystemConfigResource;
use App\Models\AdminUser;
use App\Models\SystemConfig;
use App\Support\SystemSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Livewire\Livewire;
use Spatie\Activitylog\Models\Activity;
use Tests\TestCase;

/**
 * Settings in System configs: every key the code reads exists with its code
 * default, a value must pass its key's check before it is saved (a typo can't
 * zero the platform fee or stop matching), every change is audited old → new,
 * and keys nothing reads can't be edited or added.
 */
class SettingsSafetyTest extends TestCase
{
    use RefreshDatabase;

    private AdminUser $super;

    protected function setUp(): void
    {
        parent::setUp();

        $this->super = AdminUser::create([
            'email' => 'super@errandguy.test', 'password_hash' => 'x',
            'full_name' => 'Super Admin', 'role' => 'super_admin', 'is_active' => true,
        ]);
        $this->actingAs($this->super, 'admin');
    }

    private function save(string $key, string $value): \Livewire\Features\SupportTesting\Testable
    {
        return Livewire::test(EditSystemConfig::class, ['record' => $key])
            ->fillForm(['value' => $value])
            ->call('save');
    }

    public function test_every_setting_the_code_reads_exists_with_its_code_default(): void
    {
        $expected = [
            'platform_fee_percent' => '15',
            'min_payout_amount' => '100',
            'matching_radius_km' => '10',
            'matching_retry_attempts' => '3',
            'matching_retry_delay_seconds' => '45',
            'matching_max_offers' => '5',
            'multi_stop_fee' => '15',
            'matched_acceptance_timeout_seconds' => '90',
            'auto_cancel_timeout_minutes' => '30',
            'retry_auto_cancel_timeout_minutes' => '5',
            'runner_cash_debt_limit' => '1000',
            'shopping_budget_max' => '3000',
            'ops_alert_emails' => '',
            'ops_alert_phone' => '',
            'admin_adjustment_daily_cap' => '20000',
            'admin_adjustment_alert_threshold' => '5000',
            'stall_alert_enabled' => '1',
            'stall_alert_minutes_accepted' => '30',
        ];

        foreach ($expected as $key => $value) {
            $row = SystemConfig::find($key);
            $this->assertNotNull($row, "{$key} must exist after migrating");
            $this->assertSame($value, $row->value, "{$key} starts at the value the code already falls back to");
            $this->assertSame(SystemSettings::description($key), $row->description);
        }
    }

    public function test_the_settings_migration_never_overwrites_a_value_and_reruns_cleanly(): void
    {
        $migration = require database_path('migrations/2026_10_31_000015_add_missing_settings.php');

        DB::table('system_config')->where('key', 'platform_fee_percent')->update(['value' => '12', 'description' => 'old words']);
        DB::table('system_config')->where('key', 'matching_max_offers')->delete();

        $migration->up();
        $migration->up();

        $this->assertSame('12', SystemConfig::find('platform_fee_percent')->value);
        $this->assertSame(SystemSettings::description('platform_fee_percent'), SystemConfig::find('platform_fee_percent')->description);
        $this->assertSame('5', SystemConfig::find('matching_max_offers')->value);
        $this->assertSame(1, SystemConfig::where('key', 'matching_max_offers')->count());
    }

    /**
     * Drift guard: a setting read with a literal key anywhere in app/ must be
     * listed in SystemSettings, or staff could never see or change it.
     */
    public function test_every_literal_key_read_in_the_code_is_listed(): void
    {
        $keys = [];
        foreach (File::allFiles(app_path()) as $file) {
            preg_match_all("/SystemConfig::getValue\\(\\s*'([a-z0-9_]+)'/", $file->getContents(), $m);
            $keys = [...$keys, ...$m[1]];
        }

        $this->assertNotEmpty($keys);
        foreach (array_unique($keys) as $key) {
            $this->assertTrue(SystemSettings::isKnown($key), "{$key} is read by the code but missing from SystemSettings");
        }
    }

    public function test_a_typo_cannot_zero_or_break_the_platform_fee(): void
    {
        foreach (['0', '', 'abc', '15%', '51', '1e2', '-5', '12.345'] as $bad) {
            $this->save('platform_fee_percent', $bad)->assertHasFormErrors(['value']);
        }

        $this->assertSame('15', SystemConfig::find('platform_fee_percent')->value);

        $this->save('platform_fee_percent', ' 12.50 ')->assertHasNoFormErrors();
        $this->assertSame('12.5', SystemConfig::find('platform_fee_percent')->value);
    }

    public function test_matching_settings_are_range_checked(): void
    {
        $this->save('matching_radius_km', '0')->assertHasFormErrors(['value']);
        $this->save('matching_radius_km', '500')->assertHasFormErrors(['value']);
        $this->save('matching_max_offers', '2.5')->assertHasFormErrors(['value']);
        $this->save('matching_max_offers', '0')->assertHasFormErrors(['value']);
        $this->save('matched_acceptance_timeout_seconds', '5')->assertHasFormErrors(['value']);

        $this->save('matching_radius_km', '7.5')->assertHasNoFormErrors();
        $this->save('matching_max_offers', '08')->assertHasNoFormErrors();
        $this->assertSame('7.5', SystemConfig::find('matching_radius_km')->value);
        $this->assertSame('8', SystemConfig::find('matching_max_offers')->value);
    }

    public function test_stall_thresholds_take_zero_to_switch_off_and_switches_take_on_or_off(): void
    {
        $this->save('stall_alert_minutes_accepted', '3')->assertHasFormErrors(['value']);
        $this->save('stall_alert_minutes_accepted', '0')->assertHasNoFormErrors();
        $this->assertSame('0', SystemConfig::find('stall_alert_minutes_accepted')->value);

        $this->save('stall_alert_enabled', 'yes')->assertHasFormErrors(['value']);
        $this->save('stall_alert_enabled', '0')->assertHasNoFormErrors();
        $this->assertSame('0', SystemConfig::find('stall_alert_enabled')->value);
    }

    public function test_a_change_is_audited_old_to_new_with_who_made_it(): void
    {
        $this->save('platform_fee_percent', '18')->assertHasNoFormErrors();

        $row = SystemConfig::find('platform_fee_percent');
        $this->assertSame($this->super->id, $row->updated_by);

        $entry = Activity::where('log_name', 'admin')->where('event', 'setting.changed')->sole();
        $this->assertSame($this->super->id, $entry->causer_id);
        $this->assertSame('platform_fee_percent', $entry->properties['key']);
        $this->assertSame('15', $entry->properties['old']);
        $this->assertSame('18', $entry->properties['new']);

        // Saving the same value again changes and logs nothing.
        $this->save('platform_fee_percent', '18')->assertHasNoFormErrors();
        $this->assertSame(1, Activity::where('event', 'setting.changed')->count());
    }

    public function test_the_change_applies_at_once(): void
    {
        $this->assertSame('15', SystemConfig::getValue('platform_fee_percent', '15'));

        $this->save('platform_fee_percent', '20')->assertHasNoFormErrors();

        $this->assertSame('20', SystemConfig::getValue('platform_fee_percent', '15'));
    }

    public function test_keys_nothing_reads_and_page_managed_keys_cannot_be_edited_or_added(): void
    {
        SystemConfig::setValue('some_old_unused_key', '1');

        $this->assertFalse(SystemConfigResource::canCreate());
        $this->assertFalse(SystemConfigResource::canEdit(SystemConfig::find('some_old_unused_key')));
        $this->assertFalse(SystemConfigResource::canEdit(SystemConfig::find('enabled_payment_methods')));
        $this->assertTrue(SystemConfigResource::canEdit(SystemConfig::find('platform_fee_percent')));

        Livewire::test(EditSystemConfig::class, ['record' => 'some_old_unused_key'])->assertForbidden();

        $this->assertNotEmpty(SystemSettings::rules('some_old_unused_key'));
        $this->assertSame('This setting can’t be changed here.', SystemSettings::problem('enabled_payment_methods', SystemSettings::get('enabled_payment_methods'), 'cash'));
    }

    public function test_staff_only_settings_never_reach_the_app(): void
    {
        $user = \App\Models\User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $data = $this->actingAs($user, 'sanctum')->getJson('/api/v1/config/app')->assertOk()->json('data');

        $this->assertArrayHasKey('platform_fee_percent', $data);
        foreach (['admin_adjustment_daily_cap', 'admin_adjustment_alert_threshold', 'stall_alert_enabled', 'stall_alert_minutes_accepted', 'ops_alert_emails'] as $key) {
            $this->assertArrayNotHasKey($key, $data);
        }
    }

    public function test_only_super_admins_reach_the_settings(): void
    {
        foreach (['admin', 'finance', 'support', 'ops'] as $role) {
            $this->actingAs(AdminUser::create([
                'email' => "{$role}@errandguy.test", 'password_hash' => 'x',
                'full_name' => ucfirst($role), 'role' => $role, 'is_active' => true,
            ]), 'admin');

            $this->assertFalse(SystemConfigResource::canViewAny(), "{$role} must not reach settings");
            $this->assertFalse(SystemConfigResource::canEdit(SystemConfig::find('platform_fee_percent')));
        }
    }
}
