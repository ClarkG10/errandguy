<?php

namespace Tests\Feature\Console;

use App\Models\RunnerDocument;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The one-time migration that moves legacy public-disk KYC documents onto the
 * private 'kyc' disk and backfills file_path (closing the exposure for docs
 * uploaded before the private-disk switch).
 */
class MigrateKycDocumentsToPrivateTest extends TestCase
{
    use RefreshDatabase;

    private function legacyDoc(string $type = 'government_id'): array
    {
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $profile = RunnerProfile::create(['user_id' => $user->id, 'verification_status' => 'pending']);
        $rel = "runner-documents/{$user->id}/{$type}/old.jpg";
        Storage::disk('public')->put($rel, 'GOV-ID-BYTES');
        $doc = RunnerDocument::create([
            'runner_id' => $profile->id, 'document_type' => $type,
            'file_url' => Storage::disk('public')->url($rel), 'file_path' => null, 'status' => 'approved',
        ]);

        return [$doc, $rel];
    }

    public function test_migrates_a_legacy_public_document_to_the_private_disk(): void
    {
        Storage::fake('public');
        Storage::fake('kyc');
        [$doc, $rel] = $this->legacyDoc();

        $this->artisan('errandguy:migrate-kyc-to-private')->assertSuccessful();

        $doc->refresh();
        $this->assertSame($rel, $doc->file_path);
        $this->assertNull($doc->file_url);
        Storage::disk('kyc')->assertExists($rel);
        Storage::disk('public')->assertMissing($rel); // original removed
    }

    public function test_is_idempotent_when_there_is_nothing_to_migrate(): void
    {
        Storage::fake('public');
        Storage::fake('kyc');
        // Already-private doc: has file_path, no file_url — must be left alone.
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $profile = RunnerProfile::create(['user_id' => $user->id, 'verification_status' => 'pending']);
        Storage::disk('kyc')->put($p = "runner-documents/{$user->id}/selfie/x.jpg", 'X');
        $doc = RunnerDocument::create([
            'runner_id' => $profile->id, 'document_type' => 'selfie',
            'file_path' => $p, 'file_url' => null, 'status' => 'approved',
        ]);

        $this->artisan('errandguy:migrate-kyc-to-private')
            ->expectsOutputToContain('No legacy public-disk KYC documents to migrate.')
            ->assertSuccessful();

        $doc->refresh();
        $this->assertSame($p, $doc->file_path);
    }

    public function test_dry_run_changes_nothing(): void
    {
        Storage::fake('public');
        Storage::fake('kyc');
        [$doc, $rel] = $this->legacyDoc();

        $this->artisan('errandguy:migrate-kyc-to-private', ['--dry-run' => true])->assertSuccessful();

        $doc->refresh();
        $this->assertNull($doc->file_path);
        $this->assertNotNull($doc->file_url);
        Storage::disk('kyc')->assertMissing($rel);
        Storage::disk('public')->assertExists($rel);
    }

    public function test_keep_public_copies_to_private_but_retains_the_public_original(): void
    {
        Storage::fake('public');
        Storage::fake('kyc');
        [$doc, $rel] = $this->legacyDoc();

        $this->artisan('errandguy:migrate-kyc-to-private', ['--keep-public' => true])->assertSuccessful();

        $doc->refresh();
        $this->assertSame($rel, $doc->file_path);
        $this->assertNull($doc->file_url);
        Storage::disk('kyc')->assertExists($rel);
        Storage::disk('public')->assertExists($rel); // kept
    }
}
