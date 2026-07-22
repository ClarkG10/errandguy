<?php

namespace Tests\Feature\Admin;

use App\Models\AdminUser;
use App\Models\RunnerDocument;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Covers the Phase-1 moderation + runner-verification fixes:
 *  - suspend() writes the enforced `status` column (not the non-existent
 *    `is_active`) and revokes live tokens.
 *  - the suspended-status filter and KYC-document lookup use the right columns.
 */
class AdminModerationTest extends TestCase
{
    use RefreshDatabase;

    private function actingAsAdmin(): AdminUser
    {
        $admin = AdminUser::create([
            'email' => 'admin@errandguy.test',
            'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops Admin',
            'role' => 'admin',
            'is_active' => true,
        ]);
        Sanctum::actingAs($admin);

        return $admin;
    }

    public function test_suspend_writes_status_and_revokes_tokens(): void
    {
        $this->actingAsAdmin();
        $user = User::factory()->create(['status' => 'active']);
        // A live session the suspension must cut.
        $user->createToken('mobile');
        $this->assertSame(1, $user->tokens()->count());

        $this->postJson("/api/v1/admin/users/{$user->id}/suspend", ['reason' => 'Fraud'])
            ->assertOk();

        $user->refresh();
        $this->assertSame('suspended', $user->status);
        $this->assertSame('Fraud', $user->suspended_reason);
        $this->assertNotNull($user->suspended_at);
        $this->assertSame(0, $user->tokens()->count(), 'suspension must revoke live tokens');
    }

    public function test_unsuspend_restores_active(): void
    {
        $this->actingAsAdmin();
        $user = User::factory()->create([
            'status' => 'suspended',
            'suspended_reason' => 'Fraud',
        ]);

        $this->postJson("/api/v1/admin/users/{$user->id}/unsuspend")->assertOk();

        $user->refresh();
        $this->assertSame('active', $user->status);
        $this->assertNull($user->suspended_reason);
    }

    public function test_suspended_filter_returns_only_suspended(): void
    {
        $this->actingAsAdmin();
        $suspended = User::factory()->create(['status' => 'suspended']);
        User::factory()->create(['status' => 'active']);

        $res = $this->getJson('/api/v1/admin/users?status=suspended')->assertOk();

        $ids = array_column($res->json('data'), 'id');
        $this->assertContains($suspended->id, $ids);
        $this->assertCount(1, $ids);
    }

    public function test_show_documents_resolves_by_runner_profile(): void
    {
        $this->actingAsAdmin();
        $runner = User::factory()->create(['role' => 'runner']);
        $profile = RunnerProfile::create([
            'user_id' => $runner->id,
            'verification_status' => 'pending',
        ]);
        // Documents are keyed by the PROFILE id, not the user id.
        $doc = RunnerDocument::create([
            'runner_id' => $profile->id,
            'document_type' => 'drivers_license',
            'file_url' => 'https://example.test/doc.jpg',
            'status' => 'pending',
        ]);

        $res = $this->getJson("/api/v1/admin/runners/{$runner->id}/documents")->assertOk();

        $ids = array_column($res->json('data'), 'id');
        $this->assertContains($doc->id, $ids, 'documents must be found via the runner profile id');
    }

    public function test_approve_marks_documents_approved(): void
    {
        $this->actingAsAdmin();
        $runner = User::factory()->create(['role' => 'runner']);
        $profile = RunnerProfile::create([
            'user_id' => $runner->id,
            'verification_status' => 'pending',
        ]);
        $doc = RunnerDocument::create([
            'runner_id' => $profile->id,
            'document_type' => 'drivers_license',
            'file_url' => 'https://example.test/doc.jpg',
            'status' => 'pending',
        ]);

        $this->postJson("/api/v1/admin/runners/{$runner->id}/approve")->assertOk();

        $this->assertSame('approved', $profile->fresh()->verification_status);
        $this->assertSame('approved', $doc->fresh()->status);
    }
}
