<?php

namespace Tests\Feature\Runner;

use App\Models\RunnerDocument;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * SEC-1: KYC documents must be stored on the PRIVATE disk (never the
 * world-readable public disk) with an unguessable filename, and exposed only
 * via the authenticated serve route — not a raw public URL.
 */
class DocumentUploadTest extends TestCase
{
    use RefreshDatabase;

    public function test_uploaded_document_is_stored_privately_and_served_via_an_authed_url(): void
    {
        Storage::fake('local');
        Storage::fake('public');
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $response = $this->actingAs($runner)->postJson('/api/v1/runner/documents', [
            'document_type' => 'government_id',
            'file' => UploadedFile::fake()->image('id.jpg'),
        ]);

        $response->assertStatus(201);

        $doc = RunnerDocument::firstOrFail();

        // Stored on the PRIVATE disk, not the public one.
        $this->assertNotNull($doc->file_path);
        $this->assertNull($doc->file_url, 'new KYC docs must not carry a public URL');
        Storage::disk('local')->assertExists($doc->file_path);
        Storage::disk('public')->assertDirectoryEmpty('/'); // nothing world-readable was written

        // Unguessable filename: {timestamp}_{40 random chars}.{ext}, keyed under
        // the runner's id + doc type.
        $this->assertMatchesRegularExpression(
            '#^runner-documents/'.$runner->id.'/government_id/\d{14}_[A-Za-z0-9]{40}\.(jpg|jpeg|png)$#',
            $doc->file_path,
        );

        // The API resource exposes the AUTHENTICATED serve route, not a file URL.
        $response->assertJsonPath('data.file_url', route('runner.documents.file', ['document' => $doc->id]));
    }
}
