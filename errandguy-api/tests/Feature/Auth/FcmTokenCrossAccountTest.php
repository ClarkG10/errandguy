<?php

namespace Tests\Feature\Auth;

use App\Models\DeviceToken;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * RT-1 regression: a push token identifies exactly one device, which belongs to
 * one account at a time. When a second user registers the SAME token (a shared
 * phone after an account switch), the first user's legacy fcm_token must be
 * cleared — otherwise NotificationService's fallback to that column would
 * misdeliver the first user's notifications (and PII) to the second user.
 */
class FcmTokenCrossAccountTest extends TestCase
{
    use RefreshDatabase;

    public function test_registering_a_token_clears_it_from_the_previous_user(): void
    {
        $token = 'ExponentPushToken[shared-device-abc123]';

        $userA = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $userB = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        // User A registers the device.
        $this->actingAs($userA)->putJson('/api/v1/user/fcm-token', ['fcm_token' => $token])->assertOk();
        $this->assertSame($token, $userA->fresh()->fcm_token);

        // User B logs in on the SAME device and registers the same token.
        $this->actingAs($userB)->putJson('/api/v1/user/fcm-token', ['fcm_token' => $token])->assertOk();

        // A's legacy column is cleared; only B now points at the device.
        $this->assertNull($userA->fresh()->fcm_token, 'previous user still points at the shared device');
        $this->assertSame($token, $userB->fresh()->fcm_token);

        // The device_tokens table holds exactly one row for the token → user B.
        $rows = DeviceToken::where('token', $token)->get();
        $this->assertCount(1, $rows);
        $this->assertSame($userB->id, $rows->first()->user_id);
    }
}
