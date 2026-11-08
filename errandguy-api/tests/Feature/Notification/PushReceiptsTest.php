<?php

namespace Tests\Feature\Notification;

use App\Models\AdminAlert;
use App\Models\DeviceToken;
use App\Models\PushTicket;
use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * A push "ticket" only says Expo accepted a message; uninstalled apps and
 * broken push credentials show up in the receipts read later. Nothing ever
 * read them, so a revoked FCM/APNs key would have silently stopped every push
 * on a platform — runners' offers included.
 */
class PushReceiptsTest extends TestCase
{
    use RefreshDatabase;

    public function test_accepted_pushes_are_kept_for_their_receipts(): void
    {
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        DeviceToken::create(['user_id' => $user->id, 'token' => 'ExponentPushToken[a]']);
        DeviceToken::create(['user_id' => $user->id, 'token' => 'ExponentPushToken[b]']);
        Http::fake(['exp.host/--/api/v2/push/send' => Http::response(['data' => [
            ['status' => 'ok', 'id' => 'tk-a'],
            ['status' => 'error', 'details' => ['error' => 'DeviceNotRegistered']],
        ]])]);

        app(NotificationService::class)->sendRemotePush($user->id, 'Hi', 'There');

        $this->assertSame(['tk-a' => 'ExponentPushToken[a]'], PushTicket::pluck('token', 'ticket_id')->all());
        // Rejected at send time: pruned straight away, as before.
        $this->assertFalse(DeviceToken::where('token', 'ExponentPushToken[b]')->exists());
    }

    public function test_receipts_prune_uninstalled_devices_and_flag_broken_credentials_once(): void
    {
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        DeviceToken::create(['user_id' => $user->id, 'token' => 'ExponentPushToken[gone]']);
        DeviceToken::create(['user_id' => $user->id, 'token' => 'ExponentPushToken[ok]']);
        foreach (['tk-gone' => 'gone', 'tk-cred' => 'ok', 'tk-fine' => 'ok', 'tk-young' => 'ok'] as $ticket => $token) {
            PushTicket::create(['ticket_id' => $ticket, 'token' => "ExponentPushToken[{$token}]", 'created_at' => now()->subMinutes($ticket === 'tk-young' ? 2 : 20)]);
        }
        PushTicket::create(['ticket_id' => 'tk-ancient', 'token' => 'ExponentPushToken[ok]', 'created_at' => now()->subDays(2)]);
        Http::fake(['exp.host/--/api/v2/push/getReceipts' => Http::response(['data' => [
            'tk-gone' => ['status' => 'error', 'message' => 'not registered', 'details' => ['error' => 'DeviceNotRegistered']],
            'tk-cred' => ['status' => 'error', 'message' => 'The FCM server key is invalid', 'details' => ['error' => 'InvalidCredentials']],
            'tk-fine' => ['status' => 'ok'],
        ]])]);

        $this->artisan('errandguy:check-push-receipts')->assertSuccessful();
        $this->artisan('errandguy:check-push-receipts')->assertSuccessful();

        $this->assertFalse(DeviceToken::where('token', 'ExponentPushToken[gone]')->exists());
        $this->assertTrue(DeviceToken::where('token', 'ExponentPushToken[ok]')->exists());
        // Read ones and day-old ones are gone; one sent 2 minutes ago waits.
        $this->assertSame(['tk-young'], PushTicket::pluck('ticket_id')->all());
        // Only tickets 15+ minutes old were asked about.
        Http::assertSent(fn ($request) => str_contains($request->url(), 'getReceipts') && ! in_array('tk-young', $request['ids'], true));

        $alert = AdminAlert::where('type', 'push_credentials_broken')->sole();
        $this->assertSame('critical', $alert->severity);
        $this->assertStringContainsString('InvalidCredentials', (string) $alert->body);
    }
}
