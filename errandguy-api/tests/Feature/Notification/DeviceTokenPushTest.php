<?php

namespace Tests\Feature\Notification;

use App\Models\DeviceToken;
use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class DeviceTokenPushTest extends TestCase
{
    use RefreshDatabase;

    public function test_registering_a_token_creates_a_device_token_and_keeps_legacy_column(): void
    {
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->actingAs($user)
            ->putJson('/api/v1/user/fcm-token', [
                'fcm_token' => 'ExponentPushToken[dev-a]',
                'platform' => 'ios',
            ])
            ->assertOk();

        $this->assertDatabaseHas('device_tokens', [
            'user_id' => $user->id,
            'token' => 'ExponentPushToken[dev-a]',
            'platform' => 'ios',
        ]);
        // Legacy single column still written for backward compatibility.
        $this->assertEquals('ExponentPushToken[dev-a]', $user->fresh()->fcm_token);
    }

    public function test_re_registering_same_token_does_not_duplicate(): void
    {
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        foreach (['first', 'second'] as $_) {
            $this->actingAs($user)
                ->putJson('/api/v1/user/fcm-token', ['fcm_token' => 'ExponentPushToken[dev-b]'])
                ->assertOk();
        }

        $this->assertEquals(1, DeviceToken::where('token', 'ExponentPushToken[dev-b]')->count());
    }

    public function test_push_fans_out_to_all_devices_in_a_single_expo_call(): void
    {
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok'], ['status' => 'ok']]], 200)]);

        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        DeviceToken::create(['user_id' => $user->id, 'token' => 'ExponentPushToken[dev1]']);
        DeviceToken::create(['user_id' => $user->id, 'token' => 'ExponentPushToken[dev2]']);

        app(NotificationService::class)->sendPush($user->id, 'Title', 'Body', ['type' => 'booking_update']);

        Http::assertSentCount(1);
        Http::assertSent(function ($req) {
            $to = $req->data()['to'] ?? null;

            return str_contains($req->url(), 'exp.host')
                && is_array($to) && count($to) === 2
                && in_array('ExponentPushToken[dev1]', $to, true)
                && in_array('ExponentPushToken[dev2]', $to, true);
        });
        // Both tokens are healthy → neither pruned.
        $this->assertDatabaseHas('device_tokens', ['token' => 'ExponentPushToken[dev1]']);
        $this->assertDatabaseHas('device_tokens', ['token' => 'ExponentPushToken[dev2]']);
        // In-app notification is always persisted regardless of push outcome.
        $this->assertDatabaseHas('notifications', ['user_id' => $user->id, 'title' => 'Title']);
    }

    public function test_device_not_registered_token_is_pruned(): void
    {
        Http::fake(['exp.host/*' => Http::response([
            'data' => [['status' => 'error', 'details' => ['error' => 'DeviceNotRegistered']]],
        ], 200)]);

        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        DeviceToken::create(['user_id' => $user->id, 'token' => 'ExponentPushToken[dead]']);

        app(NotificationService::class)->sendPush($user->id, 'Title', 'Body');

        $this->assertDatabaseMissing('device_tokens', ['token' => 'ExponentPushToken[dead]']);
    }

    public function test_falls_back_to_legacy_fcm_token_when_no_device_rows(): void
    {
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]], 200)]);

        // Pre-migration user: only the legacy column, no device_tokens rows.
        $user = User::factory()->create([
            'role' => 'customer', 'status' => 'active',
            'fcm_token' => 'ExponentPushToken[legacy]',
        ]);

        app(NotificationService::class)->sendPush($user->id, 'Title', 'Body');

        Http::assertSent(function ($req) {
            $to = $req->data()['to'] ?? null;

            return is_array($to) && in_array('ExponentPushToken[legacy]', $to, true);
        });
    }
}
