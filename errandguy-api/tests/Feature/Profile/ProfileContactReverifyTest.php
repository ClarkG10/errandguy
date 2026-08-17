<?php

namespace Tests\Feature\Profile;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Changing a verified contact must drop its verified badge until re-confirmed
 * via OTP — otherwise PUT /profile keeps the "verified" checkmark on an
 * unconfirmed email/phone. Unchanged fields must NOT reset. (audit M)
 */
class ProfileContactReverifyTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create([
            'role' => 'customer', 'status' => 'active',
            'email' => 'old@example.test', 'phone' => '+639171234567',
            'email_verified' => true, 'phone_verified' => true,
        ]);
    }

    public function test_changing_email_resets_only_email_verified(): void
    {
        Sanctum::actingAs($user = $this->user());

        $this->putJson('/api/v1/user/profile', ['email' => 'new@example.test'])->assertOk();

        $user->refresh();
        $this->assertFalse((bool) $user->email_verified, 'changed email must be unverified');
        $this->assertTrue((bool) $user->phone_verified, 'untouched phone stays verified');
    }

    public function test_changing_phone_resets_only_phone_verified(): void
    {
        Sanctum::actingAs($user = $this->user());

        $this->putJson('/api/v1/user/profile', ['phone' => '+639170000000'])->assertOk();

        $user->refresh();
        $this->assertFalse((bool) $user->phone_verified, 'changed phone must be unverified');
        $this->assertTrue((bool) $user->email_verified, 'untouched email stays verified');
    }

    public function test_unrelated_update_and_unchanged_contact_keep_verified(): void
    {
        Sanctum::actingAs($user = $this->user());

        // Name-only change + re-sending the SAME email must not reset anything.
        $this->putJson('/api/v1/user/profile', [
            'full_name' => 'New Name',
            'email' => 'old@example.test',
        ])->assertOk();

        $user->refresh();
        $this->assertTrue((bool) $user->email_verified);
        $this->assertTrue((bool) $user->phone_verified);
    }
}
