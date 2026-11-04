<?php

namespace Tests\Feature\Safety;

use App\Jobs\NotifySosContactsJob;
use App\Mail\SosStaffAlert;
use App\Models\AdminAlert;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\SOSAlert;
use App\Models\SystemConfig;
use App\Models\TrustedContact;
use App\Models\User;
use App\Services\NotificationService;
use App\Services\Sms\LogSmsSender;
use App\Services\SOSService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Mail;
use Mockery;
use Tests\Fakes\FakeSmsSender;
use Tests\TestCase;

/**
 * Guards the historic "SOS reaches nobody" critical. The job must text every
 * active trusted contact (with the live link), text and email the staff
 * recipients set in the admin panel, record ONLY the contacts a text was
 * accepted for, never alert the other person on the errand, and raise one
 * critical admin alert listing whatever did not go out.
 */
class NotifySosContactsJobTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private Booking $booking;
    private TrustedContact $mom;
    private TrustedContact $dad;

    protected function setUp(): void
    {
        parent::setUp();
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'full_name' => 'Maria Santos', 'phone' => '09179990000']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50.00, 'per_km_walk' => 15.00, 'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00,
            'per_km_car' => 18.00, 'is_active' => true, 'sort_order' => 1,
        ]);
        $this->booking = Booking::create([
            'booking_number' => 'EG-20260810-SOSJ',
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $errandType->id, 'status' => 'in_transit',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 100, 'is_transportation' => false,
        ]);
        $this->mom = TrustedContact::create([
            'user_id' => $this->customer->id, 'name' => 'Mom', 'phone' => '+639170000001', 'relationship' => 'family', 'priority' => 1,
        ]);
        $this->dad = TrustedContact::create([
            'user_id' => $this->customer->id, 'name' => 'Dad', 'phone' => '09170000002', 'relationship' => 'family', 'priority' => 2,
        ]);
        TrustedContact::create([
            'user_id' => $this->customer->id, 'name' => 'Old friend', 'phone' => '09170000003', 'relationship' => 'friend', 'is_active' => false,
        ]);
    }

    private function alert(): SOSAlert
    {
        return SOSAlert::create([
            'booking_id' => $this->booking->id, 'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'triggered_by' => $this->customer->id, 'triggered_by_role' => 'customer', 'triggered_at' => now(),
            'trigger_lat' => 14.5995, 'trigger_lng' => 120.9842, 'trigger_accuracy_m' => 15, 'trigger_location_source' => 'device',
            'live_link_token' => str_repeat('a', 64), 'live_link_expires_at' => now()->addHour(), 'status' => 'active',
        ]);
    }

    private function staffRecipients(string $emails = 'ops@errandguy.test, night@errandguy.test', string $phones = '09181112222'): void
    {
        SystemConfig::setValue('ops_alert_emails', $emails);
        SystemConfig::setValue('ops_alert_phone', $phones);
    }

    /**
     * `contacts_notified` is DELIVERY-CONFIRMED, never intent: triggering an
     * alert must not claim anyone was reached before a text was accepted.
     */
    public function test_triggering_claims_no_contact_was_notified(): void
    {
        Bus::fake([NotifySosContactsJob::class]);

        $alert = app(SOSService::class)->triggerSOS($this->booking->id, $this->customer->id, 'customer');

        $this->assertSame([], $alert->fresh()->contacts_notified ?? []);
        $this->assertTrue($this->booking->fresh()->sos_triggered);
        Bus::assertDispatchedAfterResponse(NotifySosContactsJob::class);
    }

    public function test_every_active_contact_and_the_staff_are_texted_and_staff_are_emailed(): void
    {
        Mail::fake();
        $this->staffRecipients();
        $alert = $this->alert();
        $sms = new FakeSmsSender(configured: true);

        (new NotifySosContactsJob($alert->id))->handle($sms);

        // Trusted contacts: both active ones, in one send, with the live link.
        $contactCall = $sms->sent[0];
        $this->assertEqualsCanonicalizing(['+639170000001', '09170000002'], $contactCall['numbers']);
        $this->assertStringContainsString('/trip/'.str_repeat('a', 64), $contactCall['message']);
        $this->assertStringContainsString('Maria', $contactCall['message']);
        $this->assertNotContains('09170000003', $sms->recipients(), 'an inactive contact is not texted');

        // Staff text: who, which errand, where.
        $staffCall = $sms->sent[1];
        $this->assertSame(['09181112222'], $staffCall['numbers']);
        $this->assertStringContainsString('Maria Santos', $staffCall['message']);
        $this->assertStringContainsString('EG-20260810-SOSJ', $staffCall['message']);
        $this->assertStringContainsString('google.com/maps?q=14.5995', $staffCall['message']);

        // Delivery-confirmed contacts only.
        $this->assertEqualsCanonicalizing([$this->mom->id, $this->dad->id], $alert->fresh()->contacts_notified);

        Mail::assertSent(SosStaffAlert::class, function (SosStaffAlert $mail): bool {
            return $mail->hasTo('ops@errandguy.test')
                && $mail->hasTo('night@errandguy.test')
                && $mail->facts['name'] === 'Maria Santos'
                && $mail->facts['role'] === 'Customer'
                && $mail->facts['phone'] === '09179990000'
                && str_contains((string) $mail->facts['errand'], 'EG-20260810-SOSJ')
                && str_contains((string) $mail->facts['map_url'], '14.5995')
                && str_contains((string) $mail->facts['panel_url'], '/admin/sos-alerts/');
        });

        $this->assertSame(0, AdminAlert::where('type', 'sos_delivery')->count(), 'everything went out');
    }

    public function test_raising_sos_over_and_over_cannot_turn_it_into_a_text_cannon(): void
    {
        Mail::fake();
        $this->staffRecipients();
        $sms = new FakeSmsSender(configured: true);

        // Four alerts in one day (raise, call off, raise again, ...).
        foreach (range(1, NotifySosContactsJob::CONTACT_TEXT_ROUNDS_PER_DAY + 1) as $_) {
            $alert = $this->alert();
            (new NotifySosContactsJob($alert->id))->handle($sms);
            $alert->update(['status' => 'cancelled']);
        }

        $contactRounds = collect($sms->sent)->filter(fn (array $call) => in_array('+639170000001', $call['numbers'], true));
        $this->assertCount(NotifySosContactsJob::CONTACT_TEXT_ROUNDS_PER_DAY, $contactRounds);

        // Staff are texted every time, and told the contacts weren't.
        $staffRounds = collect($sms->sent)->filter(fn (array $call) => $call['numbers'] === ['09181112222']);
        $this->assertCount(NotifySosContactsJob::CONTACT_TEXT_ROUNDS_PER_DAY + 1, $staffRounds);
        $this->assertStringContainsString('not texted again', AdminAlert::where('type', 'sos_delivery')->sole()->body);

        // And the person is never told their contacts are being texted when
        // they won't be.
        \Illuminate\Support\Facades\Cache::put(NotifySosContactsJob::contactRoundsKey($this->customer->id), NotifySosContactsJob::CONTACT_TEXT_ROUNDS_PER_DAY, 3600);
        $this->app->instance(\App\Services\Sms\SmsSender::class, $sms);
        $summary = app(\App\Services\SOSService::class)->alertSummary($this->alert());
        $this->assertStringNotContainsString('texting your live location', $summary['message']);
        $this->assertStringContainsString('didn’t text them again', $summary['message']);
        $this->assertSame(0, $summary['alerted']['trusted_contacts_texting']);
    }

    public function test_the_staff_email_renders(): void
    {
        $alert = $this->alert();

        $html = SosStaffAlert::forAlert($alert)->render();

        $this->assertStringContainsString('Maria Santos', $html);
        $this->assertStringContainsString('tel:09179990000', $html);
        $this->assertStringContainsString('Open the map', $html);
        $this->assertStringContainsString('has not been told', $html);
    }

    public function test_the_other_person_on_the_errand_is_not_pushed(): void
    {
        Mail::fake();
        $notifications = Mockery::spy(NotificationService::class);
        $this->app->instance(NotificationService::class, $notifications);
        $alert = $this->alert();

        (new NotifySosContactsJob($alert->id))->handle(new FakeSmsSender(configured: true));

        $notifications->shouldNotHaveReceived('sendPush');
        $notifications->shouldNotHaveReceived('notifyInApp');
    }

    public function test_only_contacts_the_provider_accepted_are_recorded_and_the_rest_are_flagged(): void
    {
        Mail::fake();
        $this->staffRecipients();
        $alert = $this->alert();

        (new NotifySosContactsJob($alert->id))->handle(new FakeSmsSender(configured: true, reject: ['09170000002']));

        $this->assertSame([$this->mom->id], $alert->fresh()->contacts_notified);
        $gap = AdminAlert::where('type', 'sos_delivery')->firstOrFail();
        $this->assertSame('critical', $gap->severity);
        $this->assertSame($alert->id, $gap->subject_id);
        $this->assertStringContainsString('1 of 2 trusted contacts could not be texted', (string) $gap->body);
    }

    public function test_with_no_sms_provider_nothing_is_claimed_and_staff_are_told_what_did_not_go_out(): void
    {
        Mail::fake();
        SystemConfig::setValue('ops_alert_emails', 'ops@errandguy.test');
        $alert = $this->alert();

        (new NotifySosContactsJob($alert->id))->handle(new LogSmsSender());

        $this->assertSame([], $alert->fresh()->contacts_notified ?? []);
        Mail::assertSent(SosStaffAlert::class, fn (SosStaffAlert $mail) => $mail->hasTo('ops@errandguy.test'));

        $body = (string) AdminAlert::where('type', 'sos_delivery')->firstOrFail()->body;
        $this->assertStringContainsString('Texts to 2 trusted contacts were not sent: SMS is not set up.', $body);
        $this->assertStringContainsString('ops_alert_phone setting is empty', $body);
        $this->assertStringNotContainsString('staff email', $body, 'the email did go out');
    }

    public function test_with_no_staff_recipients_the_gap_is_flagged(): void
    {
        Mail::fake();
        $alert = $this->alert();

        (new NotifySosContactsJob($alert->id))->handle(new FakeSmsSender(configured: true));

        Mail::assertNothingSent();
        $body = (string) AdminAlert::where('type', 'sos_delivery')->firstOrFail()->body;
        $this->assertStringContainsString('ops_alert_emails setting is empty', $body);
        $this->assertStringContainsString('ops_alert_phone setting is empty', $body);
    }

    public function test_a_failing_email_never_stops_the_texts(): void
    {
        $this->staffRecipients();
        Mail::shouldReceive('to')->andThrow(new \RuntimeException('Gmail is down'));
        $alert = $this->alert();
        $sms = new FakeSmsSender(configured: true);

        (new NotifySosContactsJob($alert->id))->handle($sms);

        $this->assertCount(2, $sms->sent, 'contacts and staff were still texted');
        $this->assertEqualsCanonicalizing([$this->mom->id, $this->dad->id], $alert->fresh()->contacts_notified);
        $this->assertStringContainsString(
            'The staff email failed to send.',
            (string) AdminAlert::where('type', 'sos_delivery')->firstOrFail()->body,
        );
    }

    public function test_a_provider_that_throws_is_contained(): void
    {
        Mail::fake();
        $this->staffRecipients();
        $alert = $this->alert();

        (new NotifySosContactsJob($alert->id))->handle(new FakeSmsSender(configured: true, throw: true));

        $this->assertSame([], $alert->fresh()->contacts_notified ?? []);
        Mail::assertSent(SosStaffAlert::class);
        $body = (string) AdminAlert::where('type', 'sos_delivery')->firstOrFail()->body;
        $this->assertStringContainsString('Texts to trusted contacts failed.', $body);
        $this->assertStringContainsString('The staff text failed.', $body);
    }

    public function test_an_alert_already_closed_sends_nothing(): void
    {
        Mail::fake();
        $this->staffRecipients();
        $alert = $this->alert();
        $alert->update(['status' => 'cancelled']);
        $sms = new FakeSmsSender(configured: true);

        (new NotifySosContactsJob($alert->id))->handle($sms);

        $this->assertSame([], $sms->sent);
        Mail::assertNothingSent();
    }
}
