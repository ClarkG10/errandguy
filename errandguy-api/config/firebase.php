<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Firebase configuration (published from kreait/laravel-firebase)
|--------------------------------------------------------------------------
|
| This is a faithful copy of the vendor default. The ONLY intentional change
| is a bounded default for http_client_options.timeout (see below): without an
| app-level config file the vendor default is `env('FIREBASE_HTTP_CLIENT_TIMEOUT')`,
| and that env var is unset, so FirebaseProjectManager applies NO timeout and the
| underlying Guzzle client waits indefinitely. A slow/unreachable googleapis.com
| then hangs whatever triggered the push — the Filament PushBroadcast web request
| (sendToTopic) or a queue worker running a notification listener (sendFCMPush).
| The sibling Expo path (NotificationService::sendExpoPush) is already bounded;
| FCM was the one outbound call left unbounded. (audit v4 reliability)
|
| Keep the rest identical to the vendor default so a future vendor:publish diff
| stays obvious. FirebaseProjectManager reads http_client_options.timeout (applied
| via withTimeOut()); it ignores connect_timeout, so only `timeout` is set here.
*/

return [

    'default' => env('FIREBASE_PROJECT', 'app'),

    'projects' => [
        'app' => [

            // Service Account. If unset, the SDK auto-discovers via
            // FIREBASE_CREDENTIALS / GOOGLE_APPLICATION_CREDENTIALS / GCE.
            'credentials' => env('FIREBASE_CREDENTIALS', env('GOOGLE_APPLICATION_CREDENTIALS')),

            'auth' => [
                'tenant_id' => env('FIREBASE_AUTH_TENANT_ID'),
            ],

            'firestore' => [
                // 'database' => env('FIREBASE_FIRESTORE_DATABASE'),
            ],

            'database' => [
                'url' => env('FIREBASE_DATABASE_URL'),
                // 'auth_variable_override' => [
                //     'uid' => 'my-service-worker'
                // ],
            ],

            'storage' => [
                'default_bucket' => env('FIREBASE_STORAGE_DEFAULT_BUCKET'),
            ],

            'cache_store' => env('FIREBASE_CACHE_STORE', 'file'),

            'logging' => [
                'http_log_channel' => env('FIREBASE_HTTP_LOG_CHANNEL'),
                'http_debug_log_channel' => env('FIREBASE_HTTP_DEBUG_LOG_CHANNEL'),
            ],

            'http_client_options' => [

                'proxy' => env('FIREBASE_HTTP_CLIENT_PROXY'),

                /*
                 * Maximum seconds (float) before an API request is considered timed
                 * out. CHANGED from the vendor default (unset env -> unbounded): a
                 * bounded 10s default so a hung googleapis.com fails fast into the
                 * existing try/catch instead of pinning the caller's thread. Still
                 * overridable via FIREBASE_HTTP_CLIENT_TIMEOUT.
                 */
                'timeout' => env('FIREBASE_HTTP_CLIENT_TIMEOUT', 10),

                'guzzle_middlewares' => [
                    // MyInvokableMiddleware::class,
                    // [MyMiddleware::class, 'static_method'],
                ],
            ],
        ],
    ],
];
