<?php

// Origins are env-driven so production never silently inherits a
// wildcard. CORS_ALLOWED_ORIGINS is a comma-separated list, e.g.
//   https://app.errandguy.app,https://admin.errandguy.app
// In local dev we fall back to common Expo / Vite origins so the
// mobile preview build and any in-house tooling keep working.
$origins = array_filter(array_map('trim', explode(',', (string) env(
    'CORS_ALLOWED_ORIGINS',
    'http://localhost:3000,http://localhost:8081,http://127.0.0.1:3000'
))));

return [
    // `broadcasting/auth` authorizes private Reverb channels. Native mobile
    // clients don't enforce CORS, but the Expo web build (and any browser
    // tooling) does, so it must be listed alongside the API paths.
    'paths' => ['api/*', 'broadcasting/auth', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => $origins,

    'allowed_origins_patterns' => [],

    'allowed_headers' => [
        'Accept',
        'Authorization',
        'Content-Type',
        'X-Requested-With',
        'X-CSRF-TOKEN',
        'X-XSRF-TOKEN',
        'X-Socket-Id',
        // The API's own middleware reads these custom request headers. Without
        // them here, a browser client (the Expo web build) has its CORS preflight
        // rejected before it can even reach the idempotency / conditional-GET
        // logic — silently breaking booking-create / top-up / payout on the web.
        'Idempotency-Key',
        'If-None-Match',
    ],

    // Let browser JS actually READ the correlation + caching headers the API sets.
    'exposed_headers' => [
        'ETag',
        'X-Request-Id',
    ],

    'max_age' => 600,

    'supports_credentials' => false,
];
