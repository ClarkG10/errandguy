<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Database backup
    |--------------------------------------------------------------------------
    |
    | Used by `php artisan errandguy:backup-database` (scheduled nightly).
    |
    | disk: the filesystem disk backups are written to. Defaults to 'local'
    |   (storage/app/backups on the app server) — a starting point that survives
    |   deploys but is NOT disaster-safe (same server as the DB). For real DR,
    |   set DB_BACKUP_DISK=s3 and configure the AWS_* env so dumps land off-site.
    |
    | path: directory within that disk.
    |
    | retention_days: dumps older than this are pruned after each run.
    |
    */

    'disk' => env('DB_BACKUP_DISK', 'local'),

    'path' => env('DB_BACKUP_PATH', 'backups'),

    'retention_days' => (int) env('DB_BACKUP_RETENTION_DAYS', 7),

];
