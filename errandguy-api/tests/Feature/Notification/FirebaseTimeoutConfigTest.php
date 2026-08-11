<?php

namespace Tests\Feature\Notification;

use Tests\TestCase;

/**
 * The FCM HTTP client MUST carry a bounded timeout. FirebaseProjectManager only
 * applies withTimeOut() when http_client_options.timeout is truthy; the vendor
 * default is env('FIREBASE_HTTP_CLIENT_TIMEOUT') which is unset -> null -> no
 * timeout -> Guzzle waits indefinitely and a hung googleapis.com pins the caller
 * (Filament PushBroadcast web request / a queue worker). This guards the sole
 * mechanism of the fix — the config value the manager consumes. (audit v4)
 */
class FirebaseTimeoutConfigTest extends TestCase
{
    public function test_fcm_http_client_has_a_bounded_timeout(): void
    {
        $timeout = config('firebase.projects.app.http_client_options.timeout');

        $this->assertNotNull($timeout, 'FCM HTTP client timeout must be configured (not the unset env default).');
        $this->assertIsNumeric($timeout);
        $this->assertGreaterThan(0, (float) $timeout);
        $this->assertLessThanOrEqual(15, (float) $timeout, 'a push timeout should be short, not effectively unbounded.');
    }
}
