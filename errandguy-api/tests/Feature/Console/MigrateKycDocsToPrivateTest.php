<?php

namespace Tests\Feature\Console;

use App\Models\RunnerDocument;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * SEC-1 existing-doc remediation: the migration command moves legacy public KYC
 * files to the private disk, repoints them, clears dangling URLs for
 * already-gone files, and is idempotent + dry-run-safe.
 */
class MigrateKycDocsToPrivateTest extends TestCase
{
    use RefreshDatabase;

    private RunnerProfile $profile;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Storage::fake('local');
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $this->profile = RunnerProfile::create([
            'user_id' => $runner->id, 'verification_status' => 'pending', 'preferred_types' => [],
        ]);
    }

    private function legacyDoc(string $type, string $path, string $bytes): RunnerDocument
    {
        Storage::disk('public')->put($path, $bytes);

        return RunnerDocument::create([
            'runner_id' => $this->profile->id, 'document_type' => $type,
            'file_url' => Storage::disk('public')->url($path), 'status' => 'approved',
        ]);
    }

    public function test_moves_legacy_public_docs_to_the_private_disk(): void
    {
        $path = 'runner-documents/x/government_id/legacy.jpg';
        $doc = $this->legacyDoc('government_id', $path, 'gov-id-bytes');

        $this->artisan('errandguy:migrate-kyc-docs-to-private')->assertExitCode(0);

        $doc->refresh();
        $this->assertSame($path, $doc->file_path);
        $this->assertNull($doc->file_url);
        Storage::disk('local')->assertExists($path);
        Storage::disk('public')->assertMissing($path); // no longer world-readable
        $this->assertSame('gov-id-bytes', Storage::disk('local')->get($path));
    }

    public function test_clears_dangling_url_when_the_public_file_is_gone(): void
    {
        // A row whose public file was already deleted — no file on disk.
        $doc = RunnerDocument::create([
            'runner_id' => $this->profile->id, 'document_type' => 'selfie',
            'file_url' => Storage::disk('public')->url('runner-documents/x/selfie/gone.jpg'), 'status' => 'approved',
        ]);

        $this->artisan('errandguy:migrate-kyc-docs-to-private')->assertExitCode(0);

        $doc->refresh();
        $this->assertNull($doc->file_url, 'dangling public URL must be cleared');
        $this->assertNull($doc->file_path);
    }

    public function test_is_idempotent_and_leaves_already_private_docs_alone(): void
    {
        $path = 'runner-documents/x/drivers_license/legacy.jpg';
        $doc = $this->legacyDoc('drivers_license', $path, 'dl');
        $this->artisan('errandguy:migrate-kyc-docs-to-private')->assertExitCode(0);

        // Second run: nothing left to migrate.
        $this->artisan('errandguy:migrate-kyc-docs-to-private')
            ->expectsOutputToContain('No legacy public KYC documents to migrate.')
            ->assertExitCode(0);

        $this->assertSame($path, $doc->fresh()->file_path);
    }

    public function test_dry_run_changes_nothing(): void
    {
        $path = 'runner-documents/x/government_id/legacy.jpg';
        $doc = $this->legacyDoc('government_id', $path, 'gov');

        $this->artisan('errandguy:migrate-kyc-docs-to-private --dry-run')->assertExitCode(0);

        $doc->refresh();
        $this->assertNull($doc->file_path); // untouched
        $this->assertNotNull($doc->file_url);
        Storage::disk('public')->assertExists($path);
        Storage::disk('local')->assertMissing($path);
    }
}
