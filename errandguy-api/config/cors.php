<?php

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],

    'allowed_origins' => [
        env('FRONTEND_URL', 'http://localhost:8081'),
        env('ADMIN_URL', 'http://localhost:3000'),
    ],

    'allowed_origins_patterns' => [
        'errandguy://*',
    ],

    'allowed_headers' => ['Authorization', 'Content-Type', 'Accept', 'X-Requested-With'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => false,
];
