<?php

namespace Tests\Feature\Runner;

use App\Models\AdminUser;
use App\Models\RunnerDocument;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * SEC-1: KYC documents on the private disk are streamed ONLY to authorized
 * viewers — the owning runner (Sanctum) and an admin (session) — never to the
 * public or another runner. Legacy public-disk docs stream through the same
 * authenticated route.
 */
class RunnerDocumentServeTest extends TestCase
{
    use RefreshDatabase;

    private User $runner;
    private RunnerProfile $profile;
    private RunnerDocument $doc;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Storage::fake('public');
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $this->profile = RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'pending', 'preferred_types' => [],
        ]);
        $path = 'runner-documents/'.$this->runner->id.'/government_id/20260810_'.str_repeat('a', 40).'.jpg';
        Storage::disk('local')->put($path, 'gov-id-bytes');
        $this->doc = RunnerDocument::create([
            'runner_id' => $this->profile->id, 'document_type' => 'government_id',
            'file_path' => $path, 'status' => 'pending',
        ]);
    }

    private function apiUrl(RunnerDocument $doc): string
    {
        return '/api/v1/runner/documents/'.$doc->id.'/file';
    }

    public function test_owning_runner_can_stream_their_document(): void
    {
        $response = $this->actingAs($this->runner)->get($this->apiUrl($this->doc));
        $response->assertOk();
        $this->assertSame('gov-id-bytes', $response->streamedContent());
    }

    public function test_a_different_runner_cannot_access_the_document(): void
    {
        $other = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create(['user_id' => $other->id, 'verification_status' => 'pending', 'preferred_types' => []]);

        $this->actingAs($other)->get($this->apiUrl($this->doc))->assertStatus(403);
    }

    public function test_unauthenticated_request_is_rejected(): void
    {
        $this->getJson($this->apiUrl($this->doc))->assertStatus(401);
    }

    public function test_admin_can_stream_any_document_via_the_web_route(): void
    {
        $admin = AdminUser::create([
            'email' => 'ops@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops', 'role' => 'admin', 'is_active' => true,
        ]);

        $response = $this->actingAs($admin, 'admin')->get('/admin/runner-documents/'.$this->doc->id.'/file');
        $response->assertOk();
        $this->assertSame('gov-id-bytes', $response->streamedContent());
    }

    public function test_legacy_public_document_still_streams_through_the_route(): void
    {
        $legacyPath = 'runner-documents/'.$this->runner->id.'/selfie/legacy.jpg';
        Storage::disk('public')->put($legacyPath, 'legacy-bytes');
        $legacy = RunnerDocument::create([
            'runner_id' => $this->profile->id, 'document_type' => 'selfie',
            'file_url' => Storage::disk('public')->url($legacyPath), 'status' => 'pending',
        ]);

        $response = $this->actingAs($this->runner)->get($this->apiUrl($legacy));
        $response->assertOk();
        $this->assertSame('legacy-bytes', $response->streamedContent());
    }
}
