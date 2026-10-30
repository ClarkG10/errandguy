<?php

namespace Tests\Feature\Safety;

use App\Events\NotificationCreated;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\SOSAlert;
use App\Models\User;
use App\Services\SOSService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * App contract, through the REAL notification path: when staff resolve an
 * SOS, the person who raised it gets one notification whose data (stored row
 * and push alike) is {type: 'sos', status: 'resolved', booking_id, alert_id}.
 * Cancelling your own alert notifies nobody.
 */
class SosResolutionNoticeTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([NotificationCreated::class]);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
        $this->booking = Booking::create([
            'booking_number' => 'EG-NOTICE-1', 'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $type->id, 'status' => 'in_transit', 'pickup_address' => 'A', 'pickup_lat' => 14.6,
            'pickup_lng' => 120.98, 'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle', 'distance_km' => 5,
            'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0, 'total_amount' => 115,
            'runner_payout' => 85, 'is_transportation' => false, 'sos_triggered' => true,
        ]);
    }

    private function alert(): SOSAlert
    {
        return SOSAlert::create([
            'booking_id' => $this->booking->id, 'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'triggered_by' => $this->customer->id, 'triggered_by_role' => 'customer', 'triggered_at' => now(),
            'live_link_token' => str_repeat('n', 64), 'live_link_expires_at' => now()->addHour(), 'status' => 'active',
        ]);
    }

    public function test_staff_resolve_sends_the_raiser_the_sos_resolved_notice(): void
    {
        $alert = $this->alert();
        $admin = AdminUser::create([
            'email' => 'safety@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Safety', 'role' => 'support', 'is_active' => true,
        ]);

        app(SOSService::class)->resolveByStaff($alert, $admin->id);

        $notices = Notification::all();
        $this->assertCount(1, $notices, 'only the person who raised it is told');
        $notice = $notices->first();
        $this->assertSame($this->customer->id, $notice->user_id);
        $this->assertSame('sos', $notice->type);
        $this->assertSame('sos', $notice->data['type']);
        $this->assertSame('resolved', $notice->data['status']);
        $this->assertSame($this->booking->id, $notice->data['booking_id']);
        $this->assertSame($alert->id, $notice->data['alert_id']);
        Event::assertDispatched(NotificationCreated::class, 1);
    }

    public function test_cancelling_your_own_alert_notifies_nobody(): void
    {
        $this->alert();

        $this->actingAs($this->customer)
            ->deleteJson("/api/v1/bookings/{$this->booking->id}/sos")
            ->assertOk()
            ->assertJsonPath('data.closed', 1);

        $this->assertSame(0, Notification::count());
        Event::assertNotDispatched(NotificationCreated::class);
    }
}
