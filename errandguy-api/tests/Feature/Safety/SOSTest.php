<?php

namespace Tests\Feature\Safety;

use App\Jobs\NotifySosContactsJob;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\SOSAlert;
use App\Models\TrustedContact;
use App\Models\User;
use App\Services\NotificationService;
use App\Services\SOSService;
use App\Services\Sms\SmsSender;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Hash;
use Mockery;
use Tests\Fakes\FakeSmsSender;
use Tests\TestCase;

class SOSTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private Booking $booking;
    private $notifications;

    protected function setUp(): void
    {
        parent::setUp();

        // Never make a real push/broadcast call; never send a real text.
        $this->notifications = Mockery::spy(NotificationService::class);
        $this->notifications->shouldReceive('notifyInApp')->andReturn(new \App\Models\Notification());
        $this->app->instance(NotificationService::class, $this->notifications);
        $this->app->instance(SmsSender::class, new FakeSmsSender(configured: false));

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'full_name' => 'Maria Santos']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'full_name' => 'Jun Cruz']);

        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'is_active' => true, 'sort_order' => 1,
        ]);

        $this->booking = Booking::create([
            'booking_number' => 'EG-20260331-SOS1',
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $errandType->id, 'status' => 'in_transit',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);
    }

    private function alert(User $by, string $role, array $extra = []): SOSAlert
    {
        return SOSAlert::create(array_merge([
            'booking_id' => $this->booking->id,
            'customer_id' => $this->customer->id,
            'runner_id' => $this->runner->id,
            'triggered_by' => $by->id,
            'triggered_by_role' => $role,
            'triggered_at' => now(),
            'status' => 'active',
            'live_link_token' => \Illuminate\Support\Str::random(64),
            'live_link_expires_at' => now()->addHour(),
        ], $extra));
    }

    private function contact(string $phone, bool $active = true): TrustedContact
    {
        return TrustedContact::create([
            'user_id' => $this->customer->id, 'name' => 'Contact '.$phone, 'phone' => $phone,
            'relationship' => 'family', 'is_active' => $active,
        ]);
    }

    public function test_customer_can_trigger_sos(): void
    {
        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/sos");

        $response->assertStatus(201)
            ->assertJsonStructure(['data', 'message', 'alerted']);

        $this->assertDatabaseHas('sos_alerts', [
            'booking_id' => $this->booking->id,
            'customer_id' => $this->customer->id,
            'triggered_by' => $this->customer->id,
            'status' => 'active',
        ]);

        $this->booking->refresh();
        $this->assertTrue($this->booking->sos_triggered);
    }

    public function test_the_phones_own_gps_is_stored_with_the_alert(): void
    {
        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/sos", [
                'lat' => 14.5995123, 'lng' => 120.9842456, 'accuracy' => 12.4,
            ])
            ->assertCreated();

        $alert = SOSAlert::firstOrFail();
        $this->assertEqualsWithDelta(14.5995123, (float) $alert->trigger_lat, 0.0000001);
        $this->assertEqualsWithDelta(120.9842456, (float) $alert->trigger_lng, 0.0000001);
        $this->assertEqualsWithDelta(12.4, (float) $alert->trigger_accuracy_m, 0.01);
        $this->assertSame(SOSAlert::LOCATION_DEVICE, $alert->trigger_location_source);
    }

    public function test_a_bad_gps_fix_never_blocks_the_sos_and_falls_back_to_the_errand_point(): void
    {
        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/sos", ['lat' => 'nope', 'lng' => 999])
            ->assertCreated();

        $alert = SOSAlert::firstOrFail();
        $this->assertSame(SOSAlert::LOCATION_ERRAND_POINT, $alert->trigger_location_source);
        $this->assertEqualsWithDelta(14.55, (float) $alert->trigger_lat, 0.0001, 'a customer falls back to the drop-off point');
        $this->assertNull($alert->trigger_accuracy_m);
    }

    public function test_a_runner_without_gps_falls_back_to_their_last_known_location(): void
    {
        RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'current_lat' => 14.5701, 'current_lng' => 121.0011, 'preferred_types' => [],
        ]);

        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$this->booking->id}/sos")
            ->assertCreated();

        $alert = SOSAlert::firstOrFail();
        $this->assertSame(SOSAlert::LOCATION_RUNNER_LAST_KNOWN, $alert->trigger_location_source);
        $this->assertEqualsWithDelta(14.5701, (float) $alert->trigger_lat, 0.0001);
        $this->assertSame('runner', $alert->triggered_by_role);
    }

    public function test_the_reply_never_claims_contacts_were_notified_and_says_who_is_being_alerted(): void
    {
        $this->contact('09170000001');

        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/sos")
            ->assertCreated();

        $message = (string) $response->json('message');
        $this->assertStringNotContainsString('have been notified', $message);
        $this->assertStringContainsString('ErrandGuy’s safety team', $message);
        // SMS is not set up here, so the reply must not promise texts.
        $this->assertStringContainsString('can’t text your trusted contacts', $message);
        $this->assertStringContainsString('911', $message);
        $response->assertJsonPath('alerted.safety_team', true)
            ->assertJsonPath('alerted.trusted_contacts_total', 1)
            ->assertJsonPath('alerted.trusted_contacts_texting', 0)
            ->assertJsonPath('data.contacts_notified', []);
    }

    public function test_the_reply_says_texts_are_on_their_way_when_sms_is_set_up(): void
    {
        $this->app->instance(SmsSender::class, new FakeSmsSender(configured: true));
        Bus::fake([NotifySosContactsJob::class]);
        $this->contact('09170000001');
        $this->contact('+639170000002');
        $this->contact('09170000003', active: false);

        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/sos")
            ->assertCreated();

        $this->assertStringContainsString('texting your live location to 2 trusted contacts now', (string) $response->json('message'));
        $response->assertJsonPath('alerted.trusted_contacts_total', 2)
            ->assertJsonPath('alerted.trusted_contacts_texting', 2);
    }

    public function test_the_reply_says_so_when_there_are_no_trusted_contacts(): void
    {
        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/sos")
            ->assertCreated();

        $this->assertStringContainsString('You have no trusted contacts saved.', (string) $response->json('message'));
    }

    public function test_trigger_runs_the_fanout_after_the_response_not_on_the_queue(): void
    {
        Bus::fake([NotifySosContactsJob::class]);

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/sos")
            ->assertCreated();

        Bus::assertDispatchedAfterResponse(NotifySosContactsJob::class);
        $this->assertCount(0, Bus::dispatched(NotifySosContactsJob::class), 'not left to the queue worker');
        $this->assertDatabaseHas('admin_alerts', ['type' => 'sos', 'severity' => 'critical']);
    }

    public function test_the_other_person_on_the_errand_is_never_told(): void
    {
        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/sos")
            ->assertCreated();

        $this->notifications->shouldNotHaveReceived('sendPush', [$this->runner->id, Mockery::any(), Mockery::any(), Mockery::any()]);
        $this->notifications->shouldNotHaveReceived('notifyInApp', [$this->runner->id, Mockery::any(), Mockery::any(), Mockery::any()]);
    }

    public function test_customer_can_cancel_their_own_sos(): void
    {
        $alert = $this->alert($this->customer, 'customer');
        $this->booking->update(['sos_triggered' => true]);

        $this->actingAs($this->customer)
            ->deleteJson("/api/v1/bookings/{$this->booking->id}/sos")
            ->assertOk()
            ->assertJsonPath('message', 'SOS alert deactivated.')
            ->assertJsonPath('data.closed', 1);

        $alert->refresh();
        $this->assertSame('cancelled', $alert->status);
        $this->assertNotNull($alert->resolved_at);
        $this->assertSame($this->customer->id, $alert->resolved_by);
        $this->assertSame('customer', $alert->resolved_by_type);
        $this->assertFalse((bool) $this->booking->fresh()->sos_triggered);
        // Cancelling tells nobody — the runner never knew.
        $this->notifications->shouldNotHaveReceived('sendPush');
    }

    public function test_the_runner_cannot_cancel_the_customers_sos(): void
    {
        $customerAlert = $this->alert($this->customer, 'customer');
        $this->booking->update(['sos_triggered' => true]);

        $this->actingAs($this->runner)
            ->deleteJson("/api/v1/runner/errand/{$this->booking->id}/sos")
            ->assertOk()
            ->assertJsonPath('data.closed', 0)
            ->assertJsonPath('message', 'You have no active SOS alert on this errand.');

        $this->assertSame('active', $customerAlert->fresh()->status);
        $this->assertTrue((bool) $this->booking->fresh()->sos_triggered);
    }

    public function test_each_side_only_closes_their_own_alerts(): void
    {
        // Both pressed SOS; the customer's two alerts (a duplicate from a past
        // race) close together, the runner's stays open.
        $this->alert($this->customer, 'customer');
        $this->alert($this->customer, 'customer', ['triggered_at' => now()->addSecond()]);
        $runnerAlert = $this->alert($this->runner, 'runner');
        $this->booking->update(['sos_triggered' => true]);

        $closed = app(SOSService::class)->cancelByRaiser($this->booking->id, $this->customer->id, 'customer');

        $this->assertSame(2, $closed);
        $this->assertSame('active', $runnerAlert->fresh()->status);
        $this->assertTrue((bool) $this->booking->fresh()->sos_triggered, 'the runner’s alert is still open');
        $this->assertCount(1, app(SOSService::class)->getActiveSOS());
    }

    public function test_pressing_twice_returns_the_same_alert_but_each_person_gets_their_own(): void
    {
        $svc = app(SOSService::class);

        $first = $svc->triggerSOS($this->booking->id, $this->customer->id, 'customer');
        $again = $svc->triggerSOS($this->booking->id, $this->customer->id, 'customer');
        $runners = $svc->triggerSOS($this->booking->id, $this->runner->id, 'runner');

        $this->assertSame($first->id, $again->id);
        $this->assertNotSame($first->id, $runners->id, 'staff must know both people pressed SOS');
        $this->assertSame(2, SOSAlert::where('booking_id', $this->booking->id)->where('status', 'active')->count());
    }

    public function test_staff_resolve_records_who_and_tells_the_person_who_raised_it(): void
    {
        $alert = $this->alert($this->runner, 'runner');
        $this->booking->update(['sos_triggered' => true]);
        $admin = AdminUser::create([
            'email' => 'safety@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Safety Desk', 'role' => 'support', 'is_active' => true,
        ]);

        $this->assertTrue(app(SOSService::class)->resolveByStaff($alert, $admin->id, 'Called the runner, all fine.'));

        $alert->refresh();
        $this->assertSame('resolved', $alert->status);
        $this->assertSame($admin->id, $alert->resolved_by);
        $this->assertSame('admin', $alert->resolved_by_type);
        $this->assertSame('Called the runner, all fine.', $alert->resolution_note);
        $this->assertSame('ErrandGuy staff (Safety Desk)', $alert->closedByLabel());
        $this->assertFalse((bool) $this->booking->fresh()->sos_triggered);

        $this->notifications->shouldHaveReceived('sendPush')
            ->withArgs(fn ($userId, $title, $body, $data) => $userId === $this->runner->id
                && ($data['type'] ?? null) === 'sos'
                && ($data['status'] ?? null) === 'resolved'
                && ($data['alert_id'] ?? null) === $alert->id)
            ->once();
        $this->notifications->shouldNotHaveReceived('sendPush', [$this->customer->id, Mockery::any(), Mockery::any(), Mockery::any()]);

        // A second resolve is a no-op and pushes nothing more.
        $this->assertFalse(app(SOSService::class)->resolveByStaff($alert, $admin->id));
        $this->notifications->shouldHaveReceived('sendPush')->once();
    }

    public function test_an_sos_still_open_a_day_after_the_errand_ended_is_closed_automatically(): void
    {
        $this->booking->update(['status' => 'completed', 'completed_at' => now()->subHours(25)]);
        $stale = $this->alert($this->customer, 'customer');
        $this->booking->update(['sos_triggered' => true]);

        $recentBooking = $this->booking->replicate(['booking_number']);
        $recentBooking->booking_number = 'EG-20260331-SOS2';
        $recentBooking->completed_at = now()->subHours(2);
        $recentBooking->save();
        $recent = $this->alert($this->customer, 'customer', ['booking_id' => $recentBooking->id]);

        $liveBooking = $this->booking->replicate(['booking_number']);
        $liveBooking->booking_number = 'EG-20260331-SOS3';
        $liveBooking->status = 'in_transit';
        $liveBooking->completed_at = null;
        $liveBooking->save();
        $live = $this->alert($this->customer, 'customer', [
            'booking_id' => $liveBooking->id, 'triggered_at' => now()->subDays(3),
        ]);

        $this->artisan('errandguy:close-stale-sos')->assertSuccessful();

        $stale->refresh();
        $this->assertSame('resolved', $stale->status);
        $this->assertSame('system', $stale->resolved_by_type);
        $this->assertStringContainsString('Closed automatically', (string) $stale->resolution_note);
        $this->assertFalse((bool) $this->booking->fresh()->sos_triggered);
        $this->assertSame('active', $recent->fresh()->status, 'ended only 2 hours ago');
        $this->assertSame('active', $live->fresh()->status, 'an errand still in progress is never touched');
    }

    public function test_non_owner_cannot_trigger_sos(): void
    {
        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $response = $this->actingAs($other)
            ->postJson("/api/v1/bookings/{$this->booking->id}/sos");

        $response->assertStatus(404);
    }

    public function test_cannot_trigger_sos_on_completed_booking(): void
    {
        $this->booking->update(['status' => 'completed']);

        $response = $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/sos");

        $response->assertStatus(404);
    }

    public function test_sos_live_link_resolves_active_alert_token(): void
    {
        // The SOS token lives on sos_alerts.live_link_token, NOT on the booking.
        // The public /trip/{token} endpoint must resolve it (it used to 404).
        $this->alert($this->customer, 'customer', ['live_link_token' => 'sos-active-token']);

        $this->getJson('/api/v1/trip/sos-active-token')
            ->assertOk()
            ->assertJsonPath('data.booking_id', $this->booking->id);
    }

    public function test_sos_live_link_works_even_after_booking_completed(): void
    {
        // Deliberate privacy override: an unresolved emergency keeps the link
        // live even once the booking closes.
        $this->alert($this->customer, 'customer', ['live_link_token' => 'sos-after-complete']);
        $this->booking->update(['status' => 'completed']);

        $this->getJson('/api/v1/trip/sos-after-complete')
            ->assertOk()
            ->assertJsonPath('data.booking_id', $this->booking->id);
    }

    public function test_sos_live_link_404_when_resolved_or_expired(): void
    {
        $this->alert($this->customer, 'customer', [
            'status' => 'resolved', 'resolved_at' => now(), 'live_link_token' => 'sos-resolved-token',
        ]);
        $this->getJson('/api/v1/trip/sos-resolved-token')->assertStatus(404);

        $this->alert($this->customer, 'customer', [
            'triggered_at' => now()->subHours(2),
            'live_link_token' => 'sos-expired-token',
            'live_link_expires_at' => now()->subMinutes(5),
        ]);
        $this->getJson('/api/v1/trip/sos-expired-token')->assertStatus(404);
    }
}
