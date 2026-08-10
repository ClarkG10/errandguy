<?php

namespace Tests\Feature\Runner;

use App\Models\RunnerDocument;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * SEC-1 hardening: KYC document URLs must not be brute-forceable. The storage
 * directory is keyed on the runner's user id (which a past customer may know)
 * and the document type (a tiny enum), so the filename must carry an
 * unguessable CSPRNG token — a bare timestamp would let the public-disk URL of
 * a government ID be enumerated.
 */
class DocumentUploadTest extends TestCase
{
    use RefreshDatabase;

    public function test_uploaded_document_gets_an_unguessable_filename(): void
    {
        Storage::fake('public');
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $response = $this->actingAs($runner)->postJson('/api/v1/runner/documents', [
            'document_type' => 'government_id',
            'file' => UploadedFile::fake()->image('id.jpg'),
        ]);

        $response->assertStatus(201);

        $doc = RunnerDocument::firstOrFail();

        // Filename = {timestamp}_{40 random chars}.{ext} — the random token makes
        // the URL impossible to guess from the known user id + document type.
        $this->assertMatchesRegularExpression(
            '#/runner-documents/'.$runner->id.'/government_id/\d{14}_[A-Za-z0-9]{40}\.(jpg|jpeg|png)$#',
            $doc->file_url,
            'document filename is not unguessable',
        );

        // The file was actually stored under that path.
        $relativePath = ltrim(parse_url($doc->file_url, PHP_URL_PATH), '/');
        $relativePath = preg_replace('#^storage/#', '', $relativePath);
        Storage::disk('public')->assertExists($relativePath);
    }
}
