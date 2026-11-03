<?php

namespace Tests\Feature\Runner;

use App\Models\AdminUser;
use App\Models\RunnerDocument;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * KYC document security. Runner identity documents live on the PRIVATE 'kyc'
 * disk (never the web-served public disk) and are retrievable only through the
 * authorized admin (session) / owner (sanctum) streaming routes. The filename
 * also carries a CSPRNG token so even a leaked path isn't enumerable (SEC-1).
 */
class DocumentUploadTest extends TestCase
{
    use RefreshDatabase;

    private function runner(): User
    {
        return User::factory()->create(['role' => 'runner', 'status' => 'active']);
    }

    private function admin(string $role = 'admin'): AdminUser
    {
        return AdminUser::forceCreate([
            'email' => $role.'@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => ucfirst($role), 'role' => $role, 'is_active' => true,
            'has_email_authentication' => true, // two-step sign-in set up
        ]);
    }

    public function test_uploaded_document_lands_on_the_private_disk_with_an_unguessable_path(): void
    {
        Storage::fake('kyc');
        Storage::fake('public');
        $runner = $this->runner();

        $response = $this->actingAs($runner)->postJson('/api/v1/runner/documents', [
            'document_type' => 'government_id',
            'file' => UploadedFile::fake()->image('id.jpg'),
        ]);

        $response->assertStatus(201);

        $doc = RunnerDocument::firstOrFail();

        // Stored on the PRIVATE disk, path recorded, and NO public URL.
        $this->assertNotNull($doc->file_path);
        $this->assertNull($doc->file_url);
        Storage::disk('kyc')->assertExists($doc->file_path);

        // The public disk never received the government ID.
        $this->assertEmpty(Storage::disk('public')->allFiles());

        // Filename = {timestamp}_{40 CSPRNG chars}.{ext} (SEC-1).
        $this->assertMatchesRegularExpression(
            '#^runner-documents/'.$runner->id.'/government_id/\d{14}_[A-Za-z0-9]{40}\.(jpg|jpeg|png)$#',
            $doc->file_path,
        );
    }

    public function test_the_submitted_notice_names_the_document_in_plain_words(): void
    {
        Storage::fake('kyc');
        $runner = $this->runner();

        $this->actingAs($runner)->postJson('/api/v1/runner/documents', [
            'document_type' => 'government_id',
            'file' => UploadedFile::fake()->image('id.jpg'),
        ])->assertStatus(201);

        $this->assertDatabaseHas('notifications', [
            'user_id' => $runner->id,
            'title' => 'Document submitted',
            'body' => 'Your government ID has been sent for review.',
        ]);
    }

    public function test_admin_can_stream_a_kyc_document_but_an_anonymous_request_cannot(): void
    {
        Storage::fake('kyc');
        $runner = $this->runner();
        $profile = RunnerProfile::create(['user_id' => $runner->id, 'verification_status' => 'pending']);
        Storage::disk('kyc')->put($path = "runner-documents/{$runner->id}/government_id/x.jpg", 'IMG');
        $doc = RunnerDocument::create([
            'runner_id' => $profile->id, 'document_type' => 'government_id',
            'file_path' => $path, 'file_url' => null, 'status' => 'pending',
        ]);

        $url = route('admin.runner-documents.file', $doc);

        // Anonymous browser request must be refused (never served the ID).
        $this->get($url)->assertStatus(403);

        // Authenticated admin (Filament session guard) gets the file.
        $this->actingAs($this->admin(), 'admin')->get($url)->assertOk();
    }

    public function test_kyc_stream_is_moderation_only_finance_and_support_forbidden(): void
    {
        Storage::fake('kyc');
        $runner = $this->runner();
        $profile = RunnerProfile::create(['user_id' => $runner->id, 'verification_status' => 'pending']);
        Storage::disk('kyc')->put($path = "runner-documents/{$runner->id}/government_id/x.jpg", 'IMG');
        $doc = RunnerDocument::create([
            'runner_id' => $profile->id, 'document_type' => 'government_id',
            'file_path' => $path, 'file_url' => null, 'status' => 'pending',
        ]);
        $url = route('admin.runner-documents.file', $doc);

        // finance + support have no verification duty and must NOT be served a
        // runner's government ID / selfie, even by direct URL.
        $this->actingAs($this->admin('finance'), 'admin')->get($url)->assertForbidden();
        $this->actingAs($this->admin('support'), 'admin')->get($url)->assertForbidden();

        // Moderation roles (ops here; admin/super covered above) may view it.
        $this->actingAs($this->admin('ops'), 'admin')->get($url)->assertOk();
    }

    public function test_owner_streams_own_document_but_another_runner_is_forbidden(): void
    {
        Storage::fake('kyc');
        $owner = $this->runner();
        $ownerProfile = RunnerProfile::create(['user_id' => $owner->id, 'verification_status' => 'pending']);
        Storage::disk('kyc')->put($path = "runner-documents/{$owner->id}/selfie/x.jpg", 'IMG');
        $doc = RunnerDocument::create([
            'runner_id' => $ownerProfile->id, 'document_type' => 'selfie',
            'file_path' => $path, 'file_url' => null, 'status' => 'pending',
        ]);

        $url = route('runner.documents.file', $doc);

        // Unauthenticated → 401.
        $this->getJson($url)->assertStatus(401);

        // A DIFFERENT runner cannot read someone else's ID → 403.
        $other = $this->runner();
        RunnerProfile::create(['user_id' => $other->id, 'verification_status' => 'pending']);
        $this->actingAs($other)->get($url)->assertStatus(403);

        // The owner can.
        $this->actingAs($owner)->get($url)->assertOk();
    }

    /**
     * The app attaches its bearer token only to /internal/runner-documents/
     * image loads, so download_url must be that route and it must accept the
     * runner's own login (it used to point at the /api twin, which the app
     * loaded without a token — the preview never showed).
     */
    public function test_the_runner_loads_their_own_document_from_download_url_with_their_login(): void
    {
        Storage::fake('kyc');
        $owner = $this->runner();
        $profile = RunnerProfile::create(['user_id' => $owner->id, 'verification_status' => 'pending']);
        Storage::disk('kyc')->put($path = "runner-documents/{$owner->id}/government_id/x.jpg", 'IMG');
        $doc = RunnerDocument::create([
            'runner_id' => $profile->id, 'document_type' => 'government_id',
            'file_path' => $path, 'file_url' => null, 'status' => 'pending',
        ]);

        $downloadUrl = (new \App\Http\Resources\RunnerDocumentResource($doc))->resolve()['download_url'];
        $this->assertSame("/internal/runner-documents/{$doc->id}/file", $downloadUrl);

        // No login → refused, never a redirect to a login page.
        $this->get($downloadUrl)->assertForbidden();

        // The owner's app token → the file, kept out of caches.
        $token = $owner->createToken('app')->plainTextToken;
        $response = $this->withToken($token)->get($downloadUrl)->assertOk();
        $this->assertSame('IMG', $response->streamedContent());
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));

        // Another runner's token → refused.
        $other = $this->runner();
        RunnerProfile::create(['user_id' => $other->id, 'verification_status' => 'pending']);
        $this->app['auth']->forgetGuards();
        $this->withToken($other->createToken('app')->plainTextToken)->get($downloadUrl)->assertForbidden();

        // A customer token → refused.
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->app['auth']->forgetGuards();
        $this->withToken($customer->createToken('app')->plainTextToken)->get($downloadUrl)->assertForbidden();
    }

    public function test_replacing_a_rejected_document_deletes_the_old_private_file(): void
    {
        Storage::fake('kyc');
        $runner = $this->runner();
        $profile = RunnerProfile::create(['user_id' => $runner->id, 'verification_status' => 'pending']);
        Storage::disk('kyc')->put($old = "runner-documents/{$runner->id}/government_id/old.jpg", 'OLD');
        RunnerDocument::create([
            'runner_id' => $profile->id, 'document_type' => 'government_id',
            'file_path' => $old, 'file_url' => null, 'status' => 'rejected',
        ]);

        $this->actingAs($runner)->postJson('/api/v1/runner/documents', [
            'document_type' => 'government_id',
            'file' => UploadedFile::fake()->image('new.jpg'),
        ])->assertStatus(201);

        // Old rejected file is gone; exactly one document row remains.
        Storage::disk('kyc')->assertMissing($old);
        $this->assertSame(1, RunnerDocument::where('runner_id', $profile->id)->count());
    }
}
