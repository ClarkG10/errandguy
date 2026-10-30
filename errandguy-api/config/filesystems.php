<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Filesystem Disk
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default filesystem disk that should be used
    | by the framework. The "local" disk, as well as a variety of cloud
    | based disks are available to your application for file storage.
    |
    */

    'default' => env('FILESYSTEM_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | Filesystem Disks
    |--------------------------------------------------------------------------
    |
    | Below you may configure as many filesystem disks as necessary, and you
    | may even configure multiple disks for the same driver. Examples for
    | most supported storage drivers are configured here for reference.
    |
    | Supported drivers: "local", "ftp", "sftp", "s3"
    |
    */

    'disks' => [

        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => true,
            'throw' => false,
            'report' => false,
        ],

        'public' => [
            'driver' => 'local',
            'root' => storage_path('app/public'),
            'url' => rtrim(env('APP_URL', 'http://localhost'), '/').'/storage',
            'visibility' => 'public',
            'throw' => false,
            'report' => false,
        ],

        // Private disk for KYC / identity documents (runner IDs). Unlike 'public'
        // it is NOT symlinked into the webroot — files are streamed ONLY through
        // the authenticated + authorized runner-document routes. Local on Forge
        // today; point KYC_FILESYSTEM_DRIVER at a private S3 bucket later without
        // touching call sites. (audit: KYC docs were on the public disk)
        'kyc' => [
            'driver' => env('KYC_FILESYSTEM_DRIVER', 'local'),
            'root' => storage_path('app/kyc'),
            'visibility' => 'private',
            'throw' => false,
            'report' => false,
        ],

        // Private disk for booking-scoped media (chat images, runner completion
        // proofs incl. RECEIPT photos, customer item photos). Like 'kyc' it is
        // NOT web-served — files are streamed only through the participant-gated
        // route (BookingMediaController), since receipt photos reveal purchases
        // and chat images are arbitrary user content. Local on Forge today; set
        // MEDIA_FILESYSTEM_DRIVER=s3 for off-site. (audit: booking media was public)
        'media' => [
            'driver' => env('MEDIA_FILESYSTEM_DRIVER', 'local'),
            'root' => storage_path('app/media'),
            'visibility' => 'private',
            'throw' => false,
            'report' => false,
        ],

        // Any S3-compatible bucket (league/flysystem-aws-s3-v3): AWS S3,
        // Cloudflare R2, DigitalOcean Spaces, Backblaze B2. Off-site backups
        // use it when DB_BACKUP_DISK=s3 (config/backup.php). For a non-AWS
        // provider set AWS_ENDPOINT to its S3 endpoint and AWS_DEFAULT_REGION to
        // its region ('auto' for R2). No ACL is sent (objects take the
        // bucket's default — keep the bucket private), and checksums only when
        // the API requires them: some S3-compatible services reject the newer
        // default ones.
        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT') ?: null,
            'use_path_style_endpoint' => (bool) env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            'request_checksum_calculation' => env('AWS_REQUEST_CHECKSUM_CALCULATION', 'when_required'),
            'response_checksum_validation' => env('AWS_RESPONSE_CHECKSUM_VALIDATION', 'when_required'),
            'throw' => false,
            'report' => false,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Symbolic Links
    |--------------------------------------------------------------------------
    |
    | Here you may configure the symbolic links that will be created when the
    | `storage:link` Artisan command is executed. The array keys should be
    | the locations of the links and the values should be their targets.
    |
    */

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],

];
