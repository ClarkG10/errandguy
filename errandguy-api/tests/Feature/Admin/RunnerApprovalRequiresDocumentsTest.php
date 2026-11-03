<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\RunnerProfiles\Pages\ListRunnerProfiles;
use App\Jobs\SendPushJob;
use App\Models\AdminUser;
use App\Models\RunnerDocument;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * A runner can only be approved once their government ID and selfie have
 * each been approved. "Approve runner" (single and bulk) is not offered
 * before that, refuses if forced, and never approves documents itself.
 */
class RunnerApprovalRequiresDocumentsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Bus::fake([SendPushJob::class]);

        $admin = AdminUser::create([
            'email' => 'ops@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops', 'role' => 'ops', 'is_active' => true,
        ]);
        $this->actingAs($admin, 'admin');
    }

    /**
     * @param  array<string, string>  $documents  document_type => status
     */
    private function runner(string $name, array $documents): RunnerProfile
    {
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active', 'full_name' => $name]);
        $profile = RunnerProfile::create(['user_id' => $user->id, 'verification_status' => 'pending']);

        foreach ($documents as $type => $status) {
            RunnerDocument::create([
                'runner_id' => $profile->id, 'document_type' => $type,
                'file_path' => "runner-documents/{$user->id}/{$type}/x.jpg", 'status' => $status,
            ]);
        }

        return $profile;
    }

    public function test_approve_is_offered_only_when_id_and_selfie_are_approved(): void
    {
        $pending = $this->runner('Pending Docs', ['government_id' => 'pending', 'selfie' => 'pending']);
        $missing = $this->runner('No Selfie', ['government_id' => 'approved']);
        $rejected = $this->runner('Bad Selfie', ['government_id' => 'approved', 'selfie' => 'rejected']);
        $ready = $this->runner('All Good', ['government_id' => 'approved', 'selfie' => 'approved']);

        Livewire::test(ListRunnerProfiles::class, ['activeTab' => 'all'])
            ->assertTableActionHidden('approve', $pending)
            ->assertTableActionHidden('approve', $missing)
            ->assertTableActionHidden('approve', $rejected)
            ->assertTableActionVisible('approve', $ready);

        $this->assertFalse($pending->hasApprovedRequiredDocuments());
        $this->assertFalse($missing->hasApprovedRequiredDocuments());
        $this->assertFalse($rejected->hasApprovedRequiredDocuments());
        $this->assertTrue($ready->hasApprovedRequiredDocuments());
    }

    public function test_approving_a_ready_runner_works_and_leaves_documents_alone(): void
    {
        $ready = $this->runner('All Good', ['government_id' => 'approved', 'selfie' => 'approved', 'drivers_license' => 'pending']);

        Livewire::test(ListRunnerProfiles::class, ['activeTab' => 'all'])
            ->callTableAction('approve', $ready)
            ->assertHasNoTableActionErrors();

        $this->assertSame('approved', $ready->fresh()->verification_status);
        $this->assertSame('pending', RunnerDocument::where('runner_id', $ready->id)->where('document_type', 'drivers_license')->value('status'),
            'approving the runner must not approve a document nobody reviewed');
        Bus::assertDispatched(SendPushJob::class);
    }

    public function test_the_approval_push_says_what_is_left_before_the_first_shift(): void
    {
        // Going online is refused without a vehicle, so "start accepting
        // errands" was untrue for a runner who hasn't saved one.
        $noVehicle = $this->runner('No Vehicle', ['government_id' => 'approved', 'selfie' => 'approved']);
        $ready = $this->runner('Has Bike', ['government_id' => 'approved', 'selfie' => 'approved']);
        $ready->update(['vehicle_type' => 'motorcycle']);

        Livewire::test(ListRunnerProfiles::class, ['activeTab' => 'all'])
            ->callTableAction('approve', $noVehicle)
            ->callTableAction('approve', $ready);

        Bus::assertDispatched(SendPushJob::class, fn (SendPushJob $job) => $job->userId === $noVehicle->user_id
            && $job->body === 'Add your vehicle in the app, then go online to start getting errands.');
        Bus::assertDispatched(SendPushJob::class, fn (SendPushJob $job) => $job->userId === $ready->user_id
            && $job->body === 'Go online in the app to start getting errands.');
    }

    public function test_bulk_approve_skips_runners_whose_documents_are_not_approved(): void
    {
        $pending = $this->runner('Pending Docs', ['government_id' => 'pending', 'selfie' => 'pending']);
        $ready = $this->runner('All Good', ['government_id' => 'approved', 'selfie' => 'approved']);

        Livewire::test(ListRunnerProfiles::class, ['activeTab' => 'all'])
            ->callTableBulkAction('bulkApprove', [$pending, $ready]);

        $this->assertSame('pending', $pending->fresh()->verification_status);
        $this->assertSame('approved', $ready->fresh()->verification_status);
        $this->assertSame(
            ['pending', 'pending'],
            RunnerDocument::where('runner_id', $pending->id)->orderBy('document_type')->pluck('status')->all(),
            'bulk approve must not approve pending documents',
        );
        Bus::assertDispatchedTimes(SendPushJob::class, 1);
    }

    public function test_rejecting_an_approved_runner_takes_them_offline_and_flags_their_errand(): void
    {
        $profile = $this->runner('Was Approved', ['government_id' => 'approved', 'selfie' => 'approved']);
        $profile->update(['verification_status' => 'approved', 'is_online' => true]);

        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = \App\Models\ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'x', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
        $booking = \App\Models\Booking::create([
            'booking_number' => 'EG-REJ-1', 'customer_id' => $customer->id, 'runner_id' => $profile->user_id,
            'errand_type_id' => $type->id, 'status' => 'picked_up', 'payment_status' => 'unpaid', 'payment_method' => 'cash',
            'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 100, 'is_transportation' => false,
        ]);

        Livewire::test(ListRunnerProfiles::class, ['activeTab' => 'all'])
            ->callTableAction('reject', $profile, ['reason' => 'ID turned out to be fake'])
            ->assertHasNoTableActionErrors();

        $profile->refresh();
        $this->assertSame('rejected', $profile->verification_status);
        $this->assertFalse((bool) $profile->is_online);
        $alert = \App\Models\AdminAlert::where('type', 'runner_suspended_mid_errand')->sole();
        $this->assertSame($booking->id, $alert->subject_id);
        $this->assertSame('Rejected runner was mid-errand', $alert->title);
    }

    public function test_runners_and_people_can_be_acted_on_from_their_own_page(): void
    {
        $ready = $this->runner('All Good', ['government_id' => 'approved', 'selfie' => 'approved']);

        Livewire::test(\App\Filament\Resources\RunnerProfiles\Pages\ViewRunnerProfile::class, ['record' => $ready->getRouteKey()])
            ->assertActionVisible('approve')
            ->assertActionVisible('reject')
            ->callAction('approve')
            ->assertHasNoActionErrors();
        $this->assertSame('approved', $ready->fresh()->verification_status);

        Livewire::test(\App\Filament\Resources\Users\Pages\ViewUser::class, ['record' => $ready->user_id])
            ->assertActionVisible('suspend')
            ->assertActionHidden('unsuspend')
            ->callAction('suspend', ['reason' => 'Reported for rude behaviour'])
            ->assertHasNoActionErrors();
        $this->assertSame('suspended', $ready->user->fresh()->status);
    }
}
