<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Mailer
    |--------------------------------------------------------------------------
    |
    | This option controls the default mailer that is used to send all email
    | messages unless another mailer is explicitly specified when sending
    | the message. All additional mailers can be configured within the
    | "mailers" array. Examples of each type of mailer are provided.
    |
    */

    'default' => env('MAIL_MAILER', 'log'),

    /*
    |--------------------------------------------------------------------------
    | Mailer Configurations
    |--------------------------------------------------------------------------
    |
    | Here you may configure all of the mailers used by your application plus
    | their respective settings. Several examples have been configured for
    | you and you are free to add your own as your application requires.
    |
    | Laravel supports a variety of mail "transport" drivers that can be used
    | when delivering an email. You may specify which one you're using for
    | your mailers below. You may also add additional mailers if needed.
    |
    | Supported: "smtp", "sendmail", "mailgun", "ses", "ses-v2",
    |            "postmark", "resend", "log", "array",
    |            "failover", "roundrobin"
    |
    */

    'mailers' => [

        'smtp' => [
            'transport' => 'smtp',
            'scheme' => env('MAIL_SCHEME'),
            'url' => env('MAIL_URL'),
            'host' => env('MAIL_HOST', '127.0.0.1'),
            'port' => env('MAIL_PORT', 2525),
            'username' => env('MAIL_USERNAME'),
            'password' => env('MAIL_PASSWORD'),
            'timeout' => null,
            'local_domain' => env('MAIL_EHLO_DOMAIN', parse_url((string) env('APP_URL', 'http://localhost'), PHP_URL_HOST)),
        ],

        'ses' => [
            'transport' => 'ses',
        ],

        'postmark' => [
            'transport' => 'postmark',
            // 'message_stream_id' => env('POSTMARK_MESSAGE_STREAM_ID'),
            // 'client' => [
            //     'timeout' => 5,
            // ],
        ],

        'resend' => [
            'transport' => 'resend',
        ],

        // Gmail REST API (users.messages.send) as support@errandguyph.com via a
        // service account with domain-wide delegation. Custom transport is
        // registered in AppServiceProvider::boot(). Provide the service-account
        // key as EITHER a file path (GMAIL_SA_PATH) OR a base64 blob (GMAIL_SA_BASE64).
        'gmail' => [
            'transport' => 'gmail',
            'impersonate' => env('GMAIL_IMPERSONATE', env('MAIL_FROM_ADDRESS')),

            // OAuth2 user-refresh-token credentials (primary — not blocked by the
            // org policy that disables service-account keys). Sends as the account
            // that minted the refresh token (support@errandguyph.com).
            'oauth_client_id' => env('GMAIL_OAUTH_CLIENT_ID'),
            'oauth_client_secret' => env('GMAIL_OAUTH_CLIENT_SECRET'),
            'oauth_refresh_token' => env('GMAIL_OAUTH_REFRESH_TOKEN'),

            // Discrete service-account fields (the individual pieces of the JSON
            // key). This is the primary style. Resolver assembles them into the
            // key array; see AppServiceProvider::resolveGmailCredentials().
            'project_id' => env('GMAIL_PROJECT_ID'),
            'private_key_id' => env('GMAIL_PRIVATE_KEY_ID'),
            'private_key' => env('GMAIL_PRIVATE_KEY'),
            'client_email' => env('GMAIL_CLIENT_EMAIL'),
            'client_id' => env('GMAIL_CLIENT_ID'),
            'client_cert_url' => env('GMAIL_CLIENT_CERT_URL'),

            // Alternatives — leave unset if using the discrete fields above.
            'credentials_base64' => env('GMAIL_SA_BASE64'),
            'credentials' => env('GMAIL_SA_PATH'),
        ],

        'sendmail' => [
            'transport' => 'sendmail',
            'path' => env('MAIL_SENDMAIL_PATH', '/usr/sbin/sendmail -bs -i'),
        ],

        'log' => [
            'transport' => 'log',
            'channel' => env('MAIL_LOG_CHANNEL'),
        ],

        'array' => [
            'transport' => 'array',
        ],

        'failover' => [
            'transport' => 'failover',
            'mailers' => [
                'smtp',
                'log',
            ],
            'retry_after' => 60,
        ],

        'roundrobin' => [
            'transport' => 'roundrobin',
            'mailers' => [
                'ses',
                'postmark',
            ],
            'retry_after' => 60,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Global "From" Address
    |--------------------------------------------------------------------------
    |
    | You may wish for all emails sent by your application to be sent from
    | the same address. Here you may specify a name and address that is
    | used globally for all emails that are sent by your application.
    |
    */

    'from' => [
        'address' => env('MAIL_FROM_ADDRESS', 'hello@example.com'),
        'name' => env('MAIL_FROM_NAME', env('APP_NAME', 'Laravel')),
    ],

];
