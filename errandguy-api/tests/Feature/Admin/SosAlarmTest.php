<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\SOSAlerts\Pages\ListSOSAlerts;
use App\Filament\Resources\SOSAlerts\Pages\ViewSOSAlert;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\SOSAlert;
use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Mockery;
use Tests\TestCase;

/**
 * Staff must hear about an SOS without anyone watching the SOS page: every
 * admin page of safety staff carries the alarm script, which polls the
 * open-alerts feed. Also covers the staff SOS page (where they are, who
 * closed it, click-to-call) and its resolve action.
 */
class SosAlarmTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();

        $notifications = Mockery::spy(NotificationService::class);
        $this->app->instance(NotificationService::class, $notifications);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'full_name' => 'Maria Santos', 'phone' => '09179990000']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'full_name' => 'Jun Cruz']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
        $this->booking = Booking::create([
            'booking_number' => 'EG-ALARM-0001',
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $type->id, 'status' => 'in_transit',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
            'sos_triggered' => true,
        ]);
    }

    private function admin(string $role): AdminUser
    {
        return AdminUser::forceCreate([
            'email' => $role.'-'.uniqid().'@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => ucfirst($role).' Person', 'role' => $role, 'is_active' => true,
            'has_email_authentication' => true, // two-step sign-in set up
        ]);
    }

    private function alert(array $extra = []): SOSAlert
    {
        return SOSAlert::create(array_merge([
            'booking_id' => $this->booking->id, 'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'triggered_by' => $this->customer->id, 'triggered_by_role' => 'customer', 'triggered_at' => now(),
            'trigger_lat' => 14.5995, 'trigger_lng' => 120.9842, 'trigger_accuracy_m' => 18,
            'trigger_location_source' => 'device',
            'live_link_token' => str_repeat('k', 64), 'live_link_expires_at' => now()->addHour(), 'status' => 'active',
        ], $extra));
    }

    public function test_the_feed_lists_open_alerts_for_safety_staff(): void
    {
        $open = $this->alert();
        $this->alert(['status' => 'resolved', 'resolved_at' => now(), 'live_link_token' => str_repeat('r', 64)]);

        $this->actingAs($this->admin('support'), 'admin')
            ->getJson('/internal/admin/sos-alarm')
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('active', 1)
            ->assertJsonCount(1, 'alerts')
            ->assertJsonPath('alerts.0.id', $open->id)
            ->assertJsonPath('alerts.0.title', 'SOS: Maria Santos (customer)')
            ->assertJsonPath('alerts.0.url', fn (string $url): bool => str_ends_with($url, "/admin/sos-alerts/{$open->id}/view"));
    }

    public function test_the_feed_is_closed_to_everyone_else(): void
    {
        $this->alert();

        $this->getJson('/internal/admin/sos-alarm')->assertForbidden();

        $this->actingAs($this->admin('finance'), 'admin')
            ->getJson('/internal/admin/sos-alarm')
            ->assertForbidden();

        // An app user's bearer is not an admin session.
        $this->actingAs($this->customer, 'sanctum')
            ->getJson('/internal/admin/sos-alarm')
            ->assertForbidden();
    }

    public function test_every_admin_page_of_safety_staff_carries_the_alarm(): void
    {
        $html = $this->actingAs($this->admin('ops'), 'admin')->get('/admin')->assertOk()->getContent();

        $this->assertStringContainsString('__egSosAlarm', $html);
        $this->assertStringContainsString('/internal/admin/sos-alarm', str_replace('\\/', '/', $html));
        $this->assertStringContainsString('data-navigate-once', $html);
    }

    public function test_staff_without_safety_duty_do_not_get_the_alarm(): void
    {
        $html = $this->actingAs($this->admin('finance'), 'admin')->get('/admin')->assertOk()->getContent();

        $this->assertStringNotContainsString('__egSosAlarm', $html);
    }

    public function test_the_sos_page_shows_where_they_are_and_lets_staff_call(): void
    {
        $alert = $this->alert();

        $this->actingAs($this->admin('support'), 'admin')
            ->get("/admin/sos-alerts/{$alert->id}/view")
            ->assertOk()
            ->assertSee('Where they are')
            ->assertSee('https://www.google.com/maps?q=14.5995000,120.9842000', false)
            ->assertSee('within about 18 m')
            ->assertSee('tel:09179990000', false)
            ->assertSee('NOT told about this alert');
    }

    public function test_the_list_shows_who_raised_it_and_cancelled_alerts(): void
    {
        $this->actingAs($this->admin('support'), 'admin');
        $cancelled = $this->alert([
            'status' => 'cancelled', 'resolved_at' => now(), 'resolved_by' => $this->customer->id,
            'resolved_by_type' => 'customer', 'live_link_token' => str_repeat('c', 64),
        ]);

        $open = $this->alert();

        Livewire::test(ListSOSAlerts::class)
            ->assertCanSeeTableRecords([$open])
            ->assertCanNotSeeTableRecords([$cancelled])
            ->set('activeTab', 'cancelled')
            ->assertCanSeeTableRecords([$cancelled])
            ->assertCanNotSeeTableRecords([$open]);

        $this->get("/admin/sos-alerts/{$cancelled->id}/view")
            ->assertOk()
            ->assertSee('Cancelled by them')
            ->assertSee('The customer who raised it');
    }

    public function test_staff_resolve_from_the_page_records_them(): void
    {
        $admin = $this->admin('support');
        $this->actingAs($admin, 'admin');
        $alert = $this->alert();

        Livewire::test(ViewSOSAlert::class, ['record' => $alert->id])
            ->callAction('resolve', ['note' => 'Spoke to her, she is safe.'])
            ->assertHasNoActionErrors();

        $alert->refresh();
        $this->assertSame('resolved', $alert->status);
        $this->assertSame($admin->id, $alert->resolved_by);
        $this->assertSame('admin', $alert->resolved_by_type);
        $this->assertSame('Spoke to her, she is safe.', $alert->resolution_note);
        $this->assertFalse((bool) $this->booking->fresh()->sos_triggered);
    }
}
