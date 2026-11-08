<?php

namespace Tests\Feature\Runner;

use App\Filament\Resources\Users\Pages\ListUsers;
use App\Jobs\AutoCancelBookingJob;
use App\Models\AdminAlert;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Services\MatchingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Queue\Events\JobProcessed;
use Illuminate\Queue\WorkerOptions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * Who is actually available for an offer, kept honest on the server:
 *
 *   - a waiting runner silent for 30 minutes is switched offline and told;
 *   - a suspended runner is offline and out of matching at once, and staff
 *     hear about any errand they were in the middle of;
 *   - nobody can switch between customer and runner mode mid-errand;
 *   - the runner's old "working radius" setting is still accepted, but only
 *     stored.
 */
class RunnerAvailabilityTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $type;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'online_since' => now()->subHour(), 'vehicle_type' => 'motorcycle',
            'current_lat' => 14.6001, 'current_lng' => 120.98, 'last_location_at' => now(),
            'preferred_types' => ['delivery'],
        ]);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function booking(array $overrides = []): Booking
    {
        return Booking::create(array_merge([
            'booking_number' => 'EG-AV-'.strtoupper(substr(md5(uniqid('', true)), 0, 6)),
            'customer_id' => $this->customer->id, 'errand_type_id' => $this->type->id,
            'status' => 'pending',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => 'cash', 'payment_status' => 'unpaid',
            'is_transportation' => false,
        ], $overrides));
    }

    private function silence(int $minutes): void
    {
        RunnerProfile::where('user_id', $this->runner->id)->update(['last_location_at' => now()->subMinutes($minutes)]);
    }

    private function sweep(): void
    {
        $this->artisan('errandguy:expire-stale-runner-presence')->assertSuccessful();
    }

    private function profile(): RunnerProfile
    {
        return RunnerProfile::where('user_id', $this->runner->id)->firstOrFail();
    }

    // ── Stale presence ──────────────────────────────────────────────────

    public function test_a_waiting_runner_silent_for_30_minutes_is_switched_offline_and_told(): void
    {
        $this->silence(31);

        $this->sweep();

        $this->assertFalse($this->profile()->is_online);
        $this->assertNull($this->profile()->online_since);
        $notice = Notification::where('user_id', $this->runner->id)->firstOrFail();
        $this->assertSame('You’re offline now', $notice->title);
        // Says what to do — the app has to be opened to go online again.
        $this->assertSame(
            'We haven’t had your location for 30 minutes. You’re offline — open ErrandGuy and switch Online on again to get errands.',
            $notice->body,
        );
        $this->assertSame('stale_location', $notice->data['reason']);
    }

    public function test_a_runner_whose_phone_just_locked_stays_online(): void
    {
        $this->silence(20);

        $this->sweep();

        $this->assertTrue($this->profile()->is_online);
        $this->assertSame(0, Notification::where('user_id', $this->runner->id)->count());
    }

    public function test_a_silent_runner_holding_an_errand_or_an_offer_is_never_switched_offline(): void
    {
        $this->silence(45);
        $this->booking(['status' => 'matched', 'runner_id' => $this->runner->id, 'matched_at' => now()]);

        $this->sweep();

        $this->assertTrue($this->profile()->is_online);
    }

    public function test_a_legacy_runner_with_no_location_at_all_is_aged_from_their_last_update(): void
    {
        DB::table('runner_profiles')->where('user_id', $this->runner->id)
            ->update(['last_location_at' => null, 'updated_at' => now()->subHour()]);

        $this->sweep();

        $this->assertFalse($this->profile()->is_online);
    }

    // ── Suspension ──────────────────────────────────────────────────────

    private function actAsOps(): void
    {
        $this->actingAs(AdminUser::create([
            'email' => 'ops@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops', 'role' => AdminUser::ROLE_OPS, 'is_active' => true,
        ]), 'admin');
    }

    public function test_suspending_a_runner_takes_them_offline_and_out_of_matching_immediately(): void
    {
        $this->actAsOps();
        $pending = $this->booking();
        $this->assertNotNull(app(MatchingService::class)->findRunner($pending->id));

        Livewire::test(ListUsers::class)
            ->callTableAction('suspend', $this->runner, ['reason' => 'Fraud report'])
            ->assertHasNoTableActionErrors();

        $this->assertSame('suspended', $this->runner->fresh()->status);
        $this->assertFalse($this->profile()->is_online);
        $this->assertNull(app(MatchingService::class)->findRunner($pending->id));
        // Not mid-errand, so nothing for staff to rescue.
        $this->assertSame(0, AdminAlert::where('type', 'runner_suspended_mid_errand')->count());
    }

    public function test_suspending_a_runner_mid_errand_alerts_staff(): void
    {
        $this->actAsOps();
        $live = $this->booking(['status' => 'picked_up', 'runner_id' => $this->runner->id]);

        Livewire::test(ListUsers::class)
            ->callTableBulkAction('suspendSelected', [$this->runner], ['reason' => 'Fraud report']);

        $this->assertSame('suspended', $this->runner->fresh()->status);
        $this->assertFalse($this->profile()->is_online);
        $alert = AdminAlert::where('type', 'runner_suspended_mid_errand')->firstOrFail();
        $this->assertSame($live->id, $alert->subject_id);
        $this->assertSame('critical', $alert->severity);
        $this->assertStringContainsString($live->booking_number, (string) $alert->body);
    }

    // ── Mode switch ─────────────────────────────────────────────────────

    public function test_a_runner_cannot_switch_to_customer_mode_mid_errand(): void
    {
        $this->booking(['status' => 'heading_to_pickup', 'runner_id' => $this->runner->id]);

        $this->actingAs($this->runner)
            ->putJson('/api/v1/user/profile', ['role' => 'customer'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'BOOKING_CONFLICT')
            ->assertJsonPath('message', 'You have an errand in progress. Finish it (or decline the offer) before switching to customer mode.');

        $this->assertSame('runner', $this->runner->fresh()->role);
    }

    public function test_switching_to_customer_mode_takes_the_runner_offline(): void
    {
        $this->actingAs($this->runner)
            ->putJson('/api/v1/user/profile', ['role' => 'customer'])
            ->assertOk();

        $this->assertSame('customer', $this->runner->fresh()->role);
        $this->assertFalse($this->profile()->is_online);
    }

    public function test_a_customer_cannot_switch_to_runner_mode_with_an_errand_open(): void
    {
        $this->booking(['status' => 'pending']);

        $this->actingAs($this->customer)
            ->putJson('/api/v1/user/profile', ['role' => 'runner'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'BOOKING_CONFLICT');

        $this->assertSame('customer', $this->customer->fresh()->role);

        // Once it's over, the switch goes through.
        Booking::where('customer_id', $this->customer->id)->update(['status' => 'completed']);
        $this->actingAs($this->customer)
            ->putJson('/api/v1/user/profile', ['role' => 'runner'])
            ->assertOk();
        $this->assertSame('runner', $this->customer->fresh()->role);
    }

    /** Nobody is on a no-runner errand and it can't be cancelled: it must not trap the switch. */
    public function test_a_no_runner_errand_does_not_block_switching_to_runner_mode(): void
    {
        $this->booking(['status' => 'no_runner']);

        $this->actingAs($this->customer)
            ->putJson('/api/v1/user/profile', ['role' => 'runner'])
            ->assertOk();
        $this->assertSame('runner', $this->customer->fresh()->role);
    }

    public function test_saving_the_same_role_mid_errand_is_not_a_switch(): void
    {
        $this->booking(['status' => 'heading_to_pickup', 'runner_id' => $this->runner->id]);

        $this->actingAs($this->runner)
            ->putJson('/api/v1/user/profile', ['role' => 'runner', 'full_name' => 'New Name'])
            ->assertOk();

        $this->assertSame('New Name', $this->runner->fresh()->full_name);
    }

    // ── Working radius ──────────────────────────────────────────────────

    public function test_the_working_radius_setting_is_still_accepted_and_stored(): void
    {
        $this->actingAs($this->runner)
            ->putJson('/api/v1/runner/profile', ['working_area_radius' => 3000])
            ->assertOk();

        $this->assertSame(3000, (int) $this->profile()->working_area_radius);
    }

    // ── Retired jobs still queued at deploy time ────────────────────────

    public function test_a_queued_job_whose_class_was_deleted_fails_cleanly_and_the_queue_moves_on(): void
    {
        // An ExpireNegotiateBookingJob (or BroadcastToRunnersJob) delayed before
        // the deploy comes due after its class is gone. It must fail on its own
        // and never block the jobs behind it.
        $failed = [];
        $processed = [];
        Event::listen(JobFailed::class, function (JobFailed $e) use (&$failed) {
            $failed[] = [$e->job->resolveName(), $e->exception->getMessage()];
        });
        Event::listen(JobProcessed::class, function (JobProcessed $e) use (&$processed) {
            $processed[] = $e->job->resolveName();
        });

        // Exactly what was serialized onto the queue before the class was deleted.
        $class = 'App\\Jobs\\ExpireNegotiateBookingJob';
        $command = 'O:'.strlen($class).':"'.$class.'":1:{s:9:"bookingId";s:36:"'.Str::uuid().'";}';
        Queue::connection('database')->pushRaw(json_encode([
            'uuid' => (string) Str::uuid(),
            'displayName' => $class,
            'job' => 'Illuminate\\Queue\\CallQueuedHandler@call',
            'maxTries' => null,
            'maxExceptions' => null,
            'failOnTimeout' => false,
            'backoff' => null,
            'timeout' => null,
            'data' => ['commandName' => $class, 'command' => $command],
        ]));
        Queue::connection('database')->push(new AutoCancelBookingJob((string) Str::uuid()));

        $worker = app('queue.worker');
        $options = new WorkerOptions(memory: 512, timeout: 0, sleep: 0, maxTries: 1);
        $worker->runNextJob('database', 'default', $options);
        $worker->runNextJob('database', 'default', $options);

        $this->assertSame(0, DB::table('jobs')->count(), 'nothing may be left stuck in the queue');
        $this->assertCount(1, $failed);
        // Failed on its own (as an incomplete class once the autoloader is
        // rebuilt on deploy, or on the missing file before that) …
        $this->assertSame($class, $failed[0][0]);
        // … and the job queued behind it still ran.
        $this->assertContains(AutoCancelBookingJob::class, $processed);
    }
}
