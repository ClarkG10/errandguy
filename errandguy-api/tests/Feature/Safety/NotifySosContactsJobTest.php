<?php

namespace Tests\Feature\Safety;

use App\Jobs\NotifySosContactsJob;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\SOSAlert;
use App\Models\TrustedContact;
use App\Models\User;
use App\Services\NotificationService;
use App\Services\SOSService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\TestCase;

/**
 * QA-5: guards the historic "SOS contacts never notified" critical. Unlike
 * SOSTest (which mocks the whole notification layer away), this exercises the
 * real SOS fan-out: that triggering records EVERY trusted contact, and that
 * the job actually reaches every trusted contact + the counterpart + the admin
 * safety topic. If someone breaks the fan-out loop, these fail.
 */
class NotifySosContactsJobTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50.00, 'per_km_walk' => 15.00, 'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00,
            'per_km_car' => 18.00, 'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
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
        foreach (['Mom' => '+639170000001', 'Dad' => '+639170000002'] as $name => $phone) {
            TrustedContact::create([
                'user_id' => $this->customer->id, 'name' => $name, 'phone' => $phone, 'relationship' => 'family',
            ]);
        }
    }

    /**
     * `contacts_notified` is DELIVERY-CONFIRMED, never intent.
     *
     * It used to be pre-filled with every trusted contact the instant the alarm
     * was pulled — before any delivery was attempted, and with no SMS provider
     * wired to attempt one. The mobile client reads this exact field to tell the
     * person in the emergency who their alert reached, so it reported "support
     * and 2 trusted contacts" when nobody had been contacted at all.
     */
    public function test_triggering_claims_no_contact_was_notified(): void
    {
        Bus::fake([NotifySosContactsJob::class]); // capture the fan-out, assert the durable record

        $alert = app(SOSService::class)->triggerSOS($this->booking->id, $this->customer->id, 'customer');

        $this->assertSame(
            [],
            $alert->fresh()->contacts_notified ?? [],
            'trigger must not claim a contact was notified before any delivery was attempted',
        );
        // The trusted contacts still exist — they are simply not yet reached.
        $this->assertCount(2, TrustedContact::where('user_id', $this->customer->id)->get());
        $this->assertTrue($this->booking->fresh()->sos_triggered);
        Bus::assertDispatched(NotifySosContactsJob::class);
    }

    /**
     * The fan-out job is the ONLY writer of `contacts_notified`, and it records a
     * contact only on confirmed delivery. No SMS provider is wired, so a full
     * run must still leave the field empty rather than back-filling intent.
     */
    public function test_fanout_records_no_contact_while_no_sms_provider_is_wired(): void
    {
        $alert = SOSAlert::create([
            'booking_id' => $this->booking->id, 'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'triggered_by' => $this->customer->id, 'triggered_by_role' => 'customer', 'triggered_at' => now(),
            'live_link_token' => str_repeat('b', 64), 'live_link_expires_at' => now()->addHour(), 'status' => 'active',
        ]);

        $notifications = Mockery::spy(NotificationService::class);
        $notifications->shouldReceive('notifyInApp')->andReturn(new Notification());
        $notifications->shouldReceive('sendPush')->andReturnNull();
        $notifications->shouldReceive('sendToTopic')->andReturnNull();

        (new NotifySosContactsJob($alert->id))->handle($notifications);

        $this->assertSame(
            [],
            $alert->fresh()->contacts_notified ?? [],
            'the fan-out must not record a contact it never actually delivered to',
        );
    }

    public function test_job_fans_out_to_every_contact_the_counterpart_and_admin(): void
    {
        $alert = SOSAlert::create([
            'booking_id' => $this->booking->id, 'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'triggered_by' => $this->customer->id, 'triggered_by_role' => 'customer', 'triggered_at' => now(),
            'live_link_token' => str_repeat('a', 64), 'live_link_expires_at' => now()->addHour(), 'status' => 'active',
        ]);

        Log::spy();
        $notifications = Mockery::spy(NotificationService::class);
        $notifications->shouldReceive('notifyInApp')->andReturn(new Notification());
        $notifications->shouldReceive('sendPush')->andReturnNull();

        (new NotifySosContactsJob($alert->id))->handle($notifications);

        // Every trusted contact is attempted (SMS is a stubbed breadcrumb until a
        // provider is wired — this asserts the loop covers all contacts).
        Log::shouldHaveReceived('warning')
            ->with('SOS trusted-contact SMS not delivered (no SMS provider configured)', Mockery::type('array'))
            ->twice();
        // The counterpart (the runner) is WOKEN, not just badged. They are the
        // one person physically present at the emergency and are usually
        // driving with the app backgrounded, so this must be a device push.
        $notifications->shouldHaveReceived('sendPush')
            ->withArgs(fn ($userId, $title, $body, $data) => $userId === $this->runner->id && ($data['type'] ?? null) === 'sos')
            ->once();
        // ...and the live-trip token never rides along into the OS
        // notification store / lock-screen preview.
        $notifications->shouldHaveReceived('sendPush')
            ->withArgs(fn ($userId, $title, $body, $data) => ! array_key_exists('live_link', $data))
            ->once();
        // The admin safety topic is alerted.
        $notifications->shouldHaveReceived('sendToTopic')
            ->withArgs(fn ($topic) => $topic === 'admin_safety')
            ->once();
    }
}
