<?php

namespace Tests\Feature\Profile;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Re-uploading an avatar must delete the previous file. The old inline path math
 * targeted 'storage/avatars/…' (wrong prefix) and silently no-op'd, orphaning
 * every prior avatar on disk. (chat/upload-hunt 2026-08-17)
 */
class AvatarOrphanCleanupTest extends TestCase
{
    use RefreshDatabase;

    public function test_new_avatar_upload_deletes_the_previous_file(): void
    {
        Storage::fake('public');
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        // An existing avatar on disk, with the user pointing at its public URL.
        Storage::disk('public')->put('avatars/old.png', 'OLD-BYTES');
        $user->update(['avatar_url' => Storage::disk('public')->url('avatars/old.png')]);
        Storage::disk('public')->assertExists('avatars/old.png');

        Sanctum::actingAs($user);
        $this->postJson('/api/v1/user/avatar', [
            'avatar' => UploadedFile::fake()->image('new.png'),
        ])->assertOk();

        // Old file removed; a fresh one written.
        Storage::disk('public')->assertMissing('avatars/old.png');
        $this->assertNotEmpty(Storage::disk('public')->files('avatars'));
    }
}
