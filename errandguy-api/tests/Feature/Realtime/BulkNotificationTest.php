<?php

namespace Tests\Feature\Realtime;

use App\Services\RealtimeService;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class BulkNotificationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.supabase.url' => 'https://sb.test',
            'services.supabase.service_key' => 'test-service-key',
        ]);
    }

    public function test_many_notifications_are_sent_in_a_single_request(): void
    {
        Http::fake(['sb.test/rest/v1/notifications' => Http::response('', 201)]);

        $sent = (new RealtimeService())->insertNotifications([
            ['user_id' => 'u1', 'title' => 'New Errand Request', 'body' => 'b', 'type' => 'booking_update', 'data' => ['booking_id' => 'bk']],
            ['user_id' => 'u2', 'title' => 'New Errand Request', 'body' => 'b', 'type' => 'booking_update', 'data' => ['booking_id' => 'bk']],
            ['user_id' => 'u3', 'title' => 'New Errand Request', 'body' => 'b', 'type' => 'booking_update', 'data' => ['booking_id' => 'bk']],
        ]);

        $this->assertEquals(3, $sent);

        // The whole point of H16: ONE HTTP round-trip regardless of N runners.
        Http::assertSentCount(1);
        Http::assertSent(function ($request) {
            $body = $request->data();

            return str_contains($request->url(), '/rest/v1/notifications')
                && is_array($body)
                && count($body) === 3
                && $body[0]['user_id'] === 'u1'
                && $body[2]['user_id'] === 'u3'
                // data stays a real object (not a double-encoded JSON string)
                && $body[0]['data'] === ['booking_id' => 'bk']
                && $body[0]['is_read'] === false;
        });
    }

    public function test_empty_list_sends_nothing(): void
    {
        Http::fake();

        $this->assertEquals(0, (new RealtimeService())->insertNotifications([]));
        Http::assertNothingSent();
    }
}
