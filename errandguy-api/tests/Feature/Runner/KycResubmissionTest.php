<?php

namespace Tests\Feature\Runner;

use App\Models\AdminAlert;
use App\Models\RunnerDocument;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Support\AdminCache;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * A rejected runner who re-uploads the fixed document must RE-ENTER the review
 * queue. Every admin surface that queues KYC work (ActionQueue "Pending
 * verifications", the RunnerProfiles sidebar badge, the pending-filter
 * deep-link) counts only verification_status = 'pending', so leaving the
 * profile 'rejected' after a resubmission made the runner invisible — blocked
 * indefinitely unless an operator happened to browse rejected profiles.
 */
class KycResubmissionTest extends TestCase
{
    use RefreshDatabase;

    private function runner(): User
    {
        return User::factory()->create([
            'role' => 'runner', 'status' => 'active', 'full_name' => 'Resub Runner',
        ]);
    }

    private function upload(User $runner, string $type = 'government_id')
    {
        return $this->actingAs($runner)->postJson('/api/v1/runner/documents', [
            'document_type' => $type,
            'file' => UploadedFile::fake()->image('fixed.jpg'),
        ]);
    }

    public function test_replacing_a_rejected_document_puts_the_profile_back_in_the_pending_queue(): void
    {
        Storage::fake('kyc');
        $runner = $this->runner();
        $profile = RunnerProfile::create([
            'user_id' => $runner->id, 'verification_status' => 'rejected',
        ]);
        Storage::disk('kyc')->put($old = "runner-documents/{$runner->id}/government_id/old.jpg", 'OLD');
        RunnerDocument::create([
            'runner_id' => $profile->id, 'document_type' => 'government_id',
            'file_path' => $old, 'file_url' => null, 'status' => 'rejected',
            'rejection_reason' => 'blurry',
        ]);

        $this->upload($runner)->assertStatus(201);

        // The load-bearing assertion: the profile is queryable by the exact
        // predicate every admin queue/badge uses.
        $this->assertSame('pending', $profile->fresh()->verification_status);
        $this->assertSame(1, RunnerProfile::pending()->where('user_id', $runner->id)->count());
        // ...and the replacement document itself is pending review.
        $this->assertSame('pending', RunnerDocument::where('runner_id', $profile->id)->firstOrFail()->status);
    }

    public function test_resubmission_busts_the_cached_verification_badge_and_queue_counts(): void
    {
        Storage::fake('kyc');
        $runner = $this->runner();
        $profile = RunnerProfile::create([
            'user_id' => $runner->id, 'verification_status' => 'rejected',
        ]);
        RunnerDocument::create([
            'runner_id' => $profile->id, 'document_type' => 'government_id',
            'file_path' => null, 'file_url' => null, 'status' => 'rejected',
        ]);

        // Warm the 60s-cached admin aggregates with the pre-resubmission count
        // (0 pending verifications) exactly as an admin page render would.
        AdminCache::remember(AdminCache::BADGE_VERIFICATIONS, fn () => 0);
        AdminCache::remember(AdminCache::QUEUE, fn (): array => ['verifications' => 0]);
        $this->assertSame(0, AdminCache::remember(AdminCache::BADGE_VERIFICATIONS, fn () => 99));

        $this->upload($runner)->assertStatus(201);

        // Both stale aggregates are gone, so the next admin render recounts and
        // the resubmitted runner appears immediately (not up to 60s later).
        $this->assertFalse(Cache::has(AdminCache::BADGE_VERIFICATIONS));
        $this->assertFalse(Cache::has(AdminCache::QUEUE));
        // Recounting now finds the resubmission.
        $this->assertSame(
            1,
            AdminCache::remember(AdminCache::BADGE_VERIFICATIONS, fn () => RunnerProfile::pending()->count()),
        );
    }

    public function test_resubmission_raises_an_operator_alert(): void
    {
        Storage::fake('kyc');
        $runner = $this->runner();
        $profile = RunnerProfile::create([
            'user_id' => $runner->id, 'verification_status' => 'rejected',
        ]);
        RunnerDocument::create([
            'runner_id' => $profile->id, 'document_type' => 'government_id',
            'file_path' => null, 'file_url' => null, 'status' => 'rejected',
        ]);

        $this->upload($runner)->assertStatus(201);

        $alert = AdminAlert::where('type', 'kyc_resubmitted')->firstOrFail();
        $this->assertSame($profile->id, $alert->subject_id);
        $this->assertStringContainsString('Resub Runner', (string) $alert->body);
        $this->assertStringContainsString('government id', (string) $alert->body);
    }

    public function test_an_approved_profile_is_never_knocked_back_to_pending_by_a_new_upload(): void
    {
        Storage::fake('kyc');
        $runner = $this->runner();
        $profile = RunnerProfile::create([
            'user_id' => $runner->id, 'verification_status' => 'approved', 'approved_at' => now(),
        ]);

        // A brand-new document type on an already-approved profile (e.g. an
        // added vehicle photo) must NOT un-approve the runner mid-errand.
        $this->upload($runner, 'selfie')->assertStatus(201);

        $this->assertSame('approved', $profile->fresh()->verification_status);
        $this->assertSame(0, AdminAlert::where('type', 'kyc_resubmitted')->count());
    }
}
