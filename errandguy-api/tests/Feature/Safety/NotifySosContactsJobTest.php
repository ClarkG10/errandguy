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

    public function test_triggering_records_every_trusted_contact(): void
    {
        Bus::fake([NotifySosContactsJob::class]); // capture the fan-out, assert the durable record

        $alert = app(SOSService::class)->triggerSOS($this->booking->id, $this->customer->id, 'customer');

        $expected = TrustedContact::where('user_id', $this->customer->id)->pluck('id')->sort()->values()->all();
        $actual = collect($alert->fresh()->contacts_notified)->sort()->values()->all();
        $this->assertSame($expected, $actual, 'not every trusted contact was recorded for notification');
        $this->assertCount(2, $actual);
        $this->assertTrue($this->booking->fresh()->sos_triggered);
        Bus::assertDispatched(NotifySosContactsJob::class);
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

        (new NotifySosContactsJob($alert->id))->handle($notifications);

        // Every trusted contact is attempted (SMS is a stubbed breadcrumb until a
        // provider is wired — this asserts the loop covers all contacts).
        Log::shouldHaveReceived('warning')
            ->with('SOS trusted-contact SMS not delivered (no SMS provider configured)', Mockery::type('array'))
            ->twice();
        // The counterpart (the runner) gets the in-app SOS banner.
        $notifications->shouldHaveReceived('notifyInApp')
            ->withArgs(fn ($userId, $title, $body, $data) => $userId === $this->runner->id && ($data['type'] ?? null) === 'sos')
            ->once();
        // The admin safety topic is alerted.
        $notifications->shouldHaveReceived('sendToTopic')
            ->withArgs(fn ($topic) => $topic === 'admin_safety')
            ->once();
    }
}
