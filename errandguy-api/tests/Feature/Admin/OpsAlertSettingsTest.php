<?php

namespace Tests\Feature\Admin;

use App\Console\Commands\AdminQueueAlertCommand;
use App\Filament\Resources\SystemConfigs\Pages\EditSystemConfig;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\SOSAlert;
use App\Models\SystemConfig;
use App\Models\User;
use App\Support\OpsAlertRecipients;
use Database\Seeders\SystemConfigSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * Who staff alerts reach is set in the admin panel (ops_alert_emails,
 * ops_alert_phone), never shown to app users, and settings nothing read are
 * gone from the panel.
 */
class OpsAlertSettingsTest extends TestCase
{
    use RefreshDatabase;

    private const RETIRED = [
        'sos_link_expiry_minutes',
        'location_update_interval_seconds',
        'max_saved_addresses',
        'max_trusted_contacts',
        'runner_payout_percent',
    ];

    private function superAdmin(): AdminUser
    {
        return AdminUser::create([
            'email' => 'super@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Super Admin', 'role' => 'super_admin', 'is_active' => true,
        ]);
    }

    public function test_the_migration_creates_both_settings_with_a_plain_description(): void
    {
        foreach (['ops_alert_emails', 'ops_alert_phone'] as $key) {
            $row = SystemConfig::find($key);
            $this->assertNotNull($row, "{$key} must exist after migrating");
            $this->assertSame('', $row->value, 'starts empty, so nothing is sent until staff fill it in');
            $this->assertStringContainsString('presses SOS', (string) $row->description);
        }
    }

    public function test_the_ops_settings_migration_keeps_a_value_staff_already_set_and_carries_the_old_address(): void
    {
        $migration = require database_path('migrations/2026_10_31_000007_add_ops_alert_settings.php');

        SystemConfig::where('key', 'ops_alert_emails')->delete();
        SystemConfig::setValue('admin_alert_email', 'legacy@errandguy.test');
        SystemConfig::setValue('ops_alert_phone', '09171234567');

        $migration->up();
        $migration->up(); // re-run is a no-op

        $this->assertSame('legacy@errandguy.test', SystemConfig::find('ops_alert_emails')->value);
        $this->assertSame('09171234567', SystemConfig::find('ops_alert_phone')->value);
    }

    public function test_app_users_never_see_who_gets_the_staff_alerts(): void
    {
        SystemConfig::setValue('ops_alert_emails', 'ops@errandguy.test');
        SystemConfig::setValue('ops_alert_phone', '09171234567');
        SystemConfig::setValue('platform_fee_percent', '15');
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $data = $this->actingAs($user)->getJson('/api/v1/config/app')->assertOk()->json('data');

        $this->assertArrayHasKey('platform_fee_percent', $data);
        foreach (SystemConfig::PRIVATE_KEYS as $key) {
            $this->assertArrayNotHasKey($key, $data);
        }
    }

    public function test_settings_nothing_reads_are_gone(): void
    {
        $this->seed(SystemConfigSeeder::class);

        foreach (self::RETIRED as $key) {
            $this->assertNull(SystemConfig::find($key), "{$key} is not read anywhere and must not be offered");
        }

        // The migration that removes them from an existing database.
        foreach (self::RETIRED as $key) {
            SystemConfig::setValue($key, '1');
        }
        (require database_path('migrations/2026_10_31_000011_remove_unused_settings.php'))->up();
        foreach (self::RETIRED as $key) {
            $this->assertNull(SystemConfig::find($key));
        }
    }

    public function test_staff_can_empty_the_ops_emails_and_typos_are_caught(): void
    {
        $this->actingAs($this->superAdmin(), 'admin');
        SystemConfig::setValue('ops_alert_emails', 'ops@errandguy.test');

        Livewire::test(EditSystemConfig::class, ['record' => 'ops_alert_emails'])
            ->fillForm(['value' => 'ops@errandguy.test, not-an-email'])
            ->call('save')
            ->assertHasFormErrors(['value']);

        Livewire::test(EditSystemConfig::class, ['record' => 'ops_alert_emails'])
            ->fillForm(['value' => ''])
            ->call('save')
            ->assertHasNoFormErrors();
        $this->assertSame('', SystemConfig::find('ops_alert_emails')->value);
        $this->assertSame([], OpsAlertRecipients::emails());

        Livewire::test(EditSystemConfig::class, ['record' => 'ops_alert_phone'])
            ->fillForm(['value' => '0917 123 4567, 12345'])
            ->call('save')
            ->assertHasFormErrors(['value']);

        Livewire::test(EditSystemConfig::class, ['record' => 'ops_alert_phone'])
            ->fillForm(['value' => '0917 123 4567, +639181234567'])
            ->call('save')
            ->assertHasNoFormErrors();
        $this->assertSame(['09171234567', '09181234567'], OpsAlertRecipients::phones());
    }

    public function test_other_settings_still_need_a_value(): void
    {
        $this->actingAs($this->superAdmin(), 'admin');
        SystemConfig::setValue('platform_fee_percent', '15');

        Livewire::test(EditSystemConfig::class, ['record' => 'platform_fee_percent'])
            ->fillForm(['value' => ''])
            ->call('save')
            ->assertHasFormErrors(['value' => 'required']);
    }

    public function test_the_digest_goes_to_the_ops_emails_and_no_longer_carries_sos(): void
    {
        SystemConfig::setValue('ops_alert_emails', 'ops@errandguy.test, bad, night@errandguy.test');
        $this->assertSame(['ops@errandguy.test', 'night@errandguy.test'], AdminQueueAlertCommand::recipients());

        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
        $booking = Booking::create([
            'booking_number' => 'EG-DIGEST-1', 'customer_id' => $customer->id, 'errand_type_id' => $type->id,
            'status' => 'in_transit', 'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02, 'schedule_type' => 'now',
            'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle', 'distance_km' => 5, 'base_fee' => 50,
            'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);
        SOSAlert::create([
            'booking_id' => $booking->id, 'customer_id' => $customer->id, 'triggered_by' => $customer->id,
            'triggered_by_role' => 'customer', 'triggered_at' => now()->subHours(3), 'status' => 'active',
            'live_link_token' => str_repeat('d', 64), 'live_link_expires_at' => now()->addHour(),
        ]);

        $this->assertNotContains('sos', array_column(AdminQueueAlertCommand::breaches(), 'key'),
            'a new SOS is emailed the moment it is raised, not by the digest');
        $this->assertNotContains('disputes', array_column(AdminQueueAlertCommand::breaches(), 'key'));

        Mail::fake();
        $this->artisan('errandguy:admin-queue-alert')->assertSuccessful();
        Mail::assertNothingSent();
    }
}
