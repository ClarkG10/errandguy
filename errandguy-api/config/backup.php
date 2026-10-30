<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Backups
    |--------------------------------------------------------------------------
    |
    | Used by `php artisan errandguy:backup-database` (nightly at 02:30 Manila,
    | and before every deploy's migrate with --skip-files).
    |
    | disk: the OFF-SITE disk copies go to — 's3' in production (any
    |   S3-compatible bucket; see the 's3' disk in config/filesystems.php and
    |   the AWS_* values in .env.production.example). 'local' means local-only:
    |   a lost server loses the database and every backup together, and
    |   `errandguy:preflight` fails in production. A local copy of each
    |   database dump is kept on the 'local' disk (storage/app/private/backups)
    |   either way.
    |
    | path: folder within each disk.
    |
    | retention_days: copies older than this are pruned after each run, on
    |   both disks.
    |
    | upload_disks: disks holding uploaded files that exist only on this
    |   server (runner ID documents, chat and errand photos). Archived nightly
    |   alongside the dump; a disk already in the cloud is skipped.
    |
    */

    'disk' => env('DB_BACKUP_DISK', 'local'),

    'path' => env('DB_BACKUP_PATH', 'backups'),

    'retention_days' => (int) env('DB_BACKUP_RETENTION_DAYS', 7),

    'upload_disks' => ['kyc', 'media'],

];
