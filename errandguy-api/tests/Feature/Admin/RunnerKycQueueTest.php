<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\RunnerProfiles\RunnerProfileResource;
use App\Models\AdminUser;
use App\Models\RunnerDocument;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Support\AdminCache;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The KYC review queue was head-blocked: a runner_profile row is created with
 * verification_status 'pending' at registration, before a single document is
 * uploaded, and the pending list is deliberately oldest-first — so the emptiest
 * applications (which can never be reviewed) sat permanently on top, and the
 * same raw count drove the sidebar badge and the dashboard's SLA card, whose
 * age was pinned to the first-ever signup.
 *
 * These tests pin the split: "ready to review" means a non-rejected document of
 * every REQUIRED_DOCUMENT_TYPE, incomplete applications stay visible under their
 * own tab, and only the reviewable ones are counted.
 */
class RunnerKycQueueTest extends TestCase
{
    use RefreshDatabase;

    private const URL = '/admin/runner-profiles';

    protected function setUp(): void
    {
        parent::setUp();

        $admin = AdminUser::create([
            'email' => 'ops@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops', 'role' => 'admin', 'is_active' => true,
        ]);
        $this->actingAs($admin, 'admin');
    }

    /**
     * @param  array<string, string>  $documents  document_type => status
     */
    private function runner(string $name, string $registeredDaysAgo, array $documents, string $status = 'pending'): RunnerProfile
    {
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active', 'full_name' => $name]);
        $profile = RunnerProfile::create(['user_id' => $user->id, 'verification_status' => $status]);
        $profile->forceFill(['created_at' => now()->subDays((int) $registeredDaysAgo)])->save();

        foreach ($documents as $type => $docStatus) {
            RunnerDocument::create([
                'runner_id' => $profile->id,
                'document_type' => $type,
                'file_path' => "runner-documents/{$user->id}/{$type}/x.jpg",
                'file_url' => null,
                'status' => $docStatus,
            ]);
        }

        return $profile;
    }

    /** The four shapes a pending profile can have. Only one is reviewable. */
    private function seedQueue(): void
    {
        // Oldest, but registered and never uploaded anything — the head-blocker.
        $this->runner('Empty Neverupload', '30', []);
        // Half an application.
        $this->runner('Half Onedoc', '20', ['government_id' => 'pending']);
        // Both types present, but the selfie was rejected — the runner still has
        // to re-upload, so this is not reviewable either.
        $this->runner('Rejected Selfie', '15', ['government_id' => 'pending', 'selfie' => 'rejected']);
        // The only one an admin can act on.
        $this->runner('Ready Complete', '2', ['government_id' => 'pending', 'selfie' => 'pending']);
    }

    public function test_ready_for_review_requires_every_required_document_non_rejected(): void
    {
        $this->seedQueue();

        $ready = RunnerProfile::query()->pending()->readyForReview()->with('user')->get();

        $this->assertCount(1, $ready);
        $this->assertSame('Ready Complete', $ready->first()->user->full_name);
    }

    public function test_awaiting_documents_is_the_exact_complement_and_hides_nobody(): void
    {
        $this->seedQueue();

        $incomplete = RunnerProfile::query()->pending()->awaitingDocuments()->get();
        $pending = RunnerProfile::query()->pending()->count();

        $this->assertSame(3, $incomplete->count());
        // Every pending profile lands in exactly one of the two buckets.
        $this->assertSame($pending, $incomplete->count() + RunnerProfile::query()->pending()->readyForReview()->count());
    }

    public function test_an_approved_runner_is_not_in_the_review_queue(): void
    {
        $this->runner('Already Approved', '5', ['government_id' => 'approved', 'selfie' => 'approved'], 'approved');

        $this->assertSame(0, RunnerProfile::query()->pending()->readyForReview()->count());
        $this->assertSame(0, RunnerProfileResource::readyForReviewCount());
    }

    public function test_the_badge_counts_only_reviewable_applications(): void
    {
        $this->seedQueue();

        AdminCache::flush();

        // 4 pending profiles, 1 of them reviewable.
        $this->assertSame(4, RunnerProfile::query()->pending()->count());
        $this->assertSame(1, RunnerProfileResource::readyForReviewCount());
        $this->assertSame('1', RunnerProfileResource::getNavigationBadge());
    }

    public function test_ready_tab_shows_the_reviewable_application_and_not_the_dead_ones(): void
    {
        $this->seedQueue();

        $this->get(self::URL.'?tab=ready')
            ->assertOk()
            ->assertSee('Ready Complete')
            ->assertDontSee('Empty Neverupload')
            ->assertDontSee('Half Onedoc');
    }

    public function test_incomplete_tab_keeps_the_unreviewable_applications_visible(): void
    {
        $this->seedQueue();

        $this->get(self::URL.'?tab=incomplete')
            ->assertOk()
            ->assertSee('Empty Neverupload')
            ->assertSee('Half Onedoc')
            ->assertDontSee('Ready Complete');
    }

    public function test_every_tab_renders_and_the_docs_column_summarises_uploads(): void
    {
        $this->seedQueue();

        foreach (['ready', 'incomplete', 'all', 'approved', 'rejected', 'online'] as $tab) {
            $this->get(self::URL.'?tab='.$tab)->assertOk();
        }

        // "2 uploaded · 2 pending" for the complete application, "None yet" for
        // the runner who never uploaded — both on the All tab.
        $this->get(self::URL.'?tab=all')
            ->assertOk()
            ->assertSee('2 uploaded')
            ->assertSee('None yet');
    }

    public function test_dashboard_action_queue_counts_only_reviewable_applications(): void
    {
        $this->seedQueue();

        AdminCache::flush();

        // The card describes the one reviewable application, and its oldest-item
        // age is that application's — NOT the 30-day-old empty profile that used
        // to pin the SLA colour red forever.
        \Livewire\Livewire::test(\App\Filament\Widgets\ActionQueue::class)
            ->assertSee('Complete applications awaiting approval', escape: false)
            ->assertSee('Oldest 2 days ago', escape: false)
            ->assertDontSee('Oldest 1 month ago');
    }

    public function test_action_queue_reads_clear_when_only_incomplete_applications_remain(): void
    {
        // Three pending profiles, none reviewable — the card must say so rather
        // than showing a red backlog an operator cannot clear.
        $this->runner('Empty Neverupload', '30', []);
        $this->runner('Half Onedoc', '20', ['government_id' => 'pending']);
        $this->runner('Rejected Selfie', '15', ['government_id' => 'pending', 'selfie' => 'rejected']);

        AdminCache::flush();

        $this->assertNull(RunnerProfileResource::getNavigationBadge());

        \Livewire\Livewire::test(\App\Filament\Widgets\ActionQueue::class)
            ->assertSee('Nothing ready to review', escape: false);
    }
}
