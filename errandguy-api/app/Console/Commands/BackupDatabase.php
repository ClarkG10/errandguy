<?php

namespace App\Console\Commands;

use App\Models\AdminAlert;
use App\Support\Backup\DatabaseDumper;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\Process;

/**
 * Nightly backup: a gzip'd mysqldump of the database, plus a tar.gz of the
 * uploaded files that live only on this server (runner ID documents on the
 * 'kyc' disk, chat and errand photos on the 'media' disk). This is the
 * disaster-recovery floor behind a deploy that runs an irreversible
 * `migrate --force` — NOT point-in-time recovery (a dump loses everything
 * written since it ran).
 *
 * Where copies go:
 *   - the database dump is ALWAYS written to the local disk first
 *     (storage/app/private/backups), so a restore never depends on the cloud;
 *   - then both files are copied to the off-site disk (config backup.disk,
 *     e.g. 's3' — AWS S3, Cloudflare R2, DigitalOcean Spaces, Backblaze B2);
 *   - the uploads archive stays local only when there is no off-site disk or
 *     the copy failed, and then only the newest one (keeping a nightly copy
 *     of every upload on the same disk would fill it).
 * Old copies are pruned on both disks after backup.retention_days.
 *
 * Exit code: FAILURE only when no local database dump could be made — that is
 * what stops the deploy's migrate step (deploy.sh). An off-site or uploads
 * failure still exits SUCCESS so deploys keep working, but every failure
 * raises an AdminAlert and a CRITICAL log line.
 *
 * --skip-files backs up the database only (the deploy's pre-migrate copy).
 */
class BackupDatabase extends Command
{
    public const LOCAL_DISK = 'local';

    protected $signature = 'errandguy:backup-database
        {--keep-days= : Override config retention (days)}
        {--skip-files : Back up the database only, not the uploaded files}';

    protected $description = 'Back up the database (and uploaded files) locally and to the off-site backup disk, and prune old copies.';

    /** @var array<int, string> */
    private array $failures = [];

    public function handle(DatabaseDumper $dumper): int
    {
        $offsite = self::offsiteDisk();
        $dir = trim((string) config('backup.path', 'backups'), '/');
        $keepDays = (int) ($this->option('keep-days') ?? config('backup.retention_days', 7));
        $stamp = now()->format('Ymd_His');

        if ($offsite === null) {
            $this->warn('No off-site backup disk is configured (DB_BACKUP_DISK) — copies stay on this server only.');
        }

        // 1. Database — the copy the deploy depends on.
        $dumpPath = $dir.'/'.$dumper->databaseName().'-'.$stamp.'.sql.gz';
        $tmp = tempnam(sys_get_temp_dir(), 'egbackup_');

        try {
            try {
                $dumper->dump($tmp);
                self::store(self::LOCAL_DISK, $dumpPath, $tmp);
            } catch (\Throwable $e) {
                $this->error("Backup failed: {$e->getMessage()}");
                $this->failures[] = 'Database dump: '.$e->getMessage();
                $this->raiseAlert();

                return self::FAILURE;
            }

            $this->info('Database dump saved locally: '.self::LOCAL_DISK.':'.$dumpPath.' ('.self::humanBytes((int) filesize($tmp)).').');

            if ($offsite !== null) {
                $this->copyOffsite($offsite, $dumpPath, $tmp, 'Database dump');
            }
        } finally {
            @unlink($tmp);
        }

        // 2. Uploaded files.
        if (! $this->option('skip-files')) {
            $this->backUpUploads($offsite, $dir.'/uploads-'.$stamp.'.tar.gz');
        }

        // 3. Retention, on every disk a copy may be on.
        foreach (array_unique(array_filter([self::LOCAL_DISK, $offsite])) as $disk) {
            try {
                $pruned = self::pruneOldBackups($disk, $dir, $keepDays);
                $this->line("Pruned {$pruned} backup(s) older than {$keepDays} day(s) on {$disk}.");
            } catch (\Throwable $e) {
                $this->failures[] = "Pruning old backups on {$disk}: ".$e->getMessage();
            }
        }

        if ($this->failures !== []) {
            $this->raiseAlert();
            $this->warn('Backup finished with problems — see the admin alert.');
        }

        return self::SUCCESS;
    }

    /**
     * The off-site disk backups are copied to, or null when backups are
     * local-only (no disk configured, or one that is a folder on this server).
     */
    public static function offsiteDisk(): ?string
    {
        $disk = (string) config('backup.disk', self::LOCAL_DISK);

        if ($disk === '' || $disk === self::LOCAL_DISK) {
            return null;
        }

        $driver = config("filesystems.disks.{$disk}.driver");

        return $driver === null || $driver === 'local' ? null : $disk;
    }

    private function backUpUploads(?string $offsite, string $archivePath): void
    {
        $sources = self::uploadSources();
        if ($sources === []) {
            $this->line('No local upload folders to back up.');

            return;
        }

        $tmp = tempnam(sys_get_temp_dir(), 'eguploads_');

        try {
            $args = ['tar', '-czf', $tmp];
            foreach ($sources as $root) {
                array_push($args, '-C', dirname($root), basename($root));
            }

            $process = new Process($args, null, null, null, 1800);
            $process->run();
            // GNU tar exits 1 when a file changed while it was read (a photo
            // uploaded mid-backup); the archive is still complete otherwise.
            $changedWhileReading = $process->getExitCode() === 1
                && str_contains($process->getErrorOutput(), 'changed as we read it');
            if ((! $process->isSuccessful() && ! $changedWhileReading) || (int) filesize($tmp) === 0) {
                throw new \RuntimeException(trim($process->getErrorOutput()) ?: 'tar failed');
            }

            if ($offsite !== null && $this->copyOffsite($offsite, $archivePath, $tmp, 'Uploaded files')) {
                self::dropLocalUploadArchives(except: null);

                return;
            }

            // No off-site copy: keep one here rather than none — only the
            // newest, so a run of failures can't fill the server's disk.
            self::store(self::LOCAL_DISK, $archivePath, $tmp);
            self::dropLocalUploadArchives(except: $archivePath);
            $this->info('Uploaded files saved locally: '.self::LOCAL_DISK.':'.$archivePath.'.');
        } catch (\Throwable $e) {
            $this->error("Uploaded files backup failed: {$e->getMessage()}");
            $this->failures[] = 'Uploaded files archive: '.$e->getMessage();
        } finally {
            @unlink($tmp);
        }
    }

    /** Local uploads archives are a stopgap: at most one is kept on this server. */
    private static function dropLocalUploadArchives(?string $except): void
    {
        $dir = trim((string) config('backup.path', 'backups'), '/');

        foreach (Storage::disk(self::LOCAL_DISK)->files($dir) as $file) {
            if ($file !== $except && preg_match('#/uploads-\d{8}_\d{6}\.tar\.gz$#', '/'.$file) === 1) {
                Storage::disk(self::LOCAL_DISK)->delete($file);
            }
        }
    }

    private function copyOffsite(string $disk, string $path, string $localFile, string $what): bool
    {
        try {
            self::store($disk, $path, $localFile);
            $this->info("{$what} copied off-site: {$disk}:{$path}.");

            return true;
        } catch (\Throwable $e) {
            $this->error("{$what} could not be copied to {$disk}: {$e->getMessage()}");
            $this->failures[] = "{$what} off-site copy to '{$disk}': ".$e->getMessage();

            return false;
        }
    }

    /**
     * Local roots of the upload disks (config backup.upload_disks) that are
     * folders on this server and exist. A disk already in the cloud needs no
     * copy here.
     *
     * @return array<int, string>
     */
    public static function uploadSources(): array
    {
        $roots = [];
        foreach ((array) config('backup.upload_disks', []) as $disk) {
            if (config("filesystems.disks.{$disk}.driver") !== 'local') {
                continue;
            }
            $root = rtrim(Storage::disk($disk)->path(''), DIRECTORY_SEPARATOR);
            if ($root !== '' && is_dir($root)) {
                $roots[] = $root;
            }
        }

        return array_values(array_unique($roots));
    }

    /**
     * Copy a local file onto a disk. The disks don't throw (throw => false), so
     * a false return — bad credentials, missing bucket — is turned into an
     * exception here instead of passing silently.
     */
    private static function store(string $disk, string $path, string $localFile): void
    {
        $stream = fopen($localFile, 'r');
        if ($stream === false) {
            throw new \RuntimeException("could not read {$localFile}");
        }

        try {
            if (Storage::disk($disk)->writeStream($path, $stream) === false) {
                throw new \RuntimeException("the '{$disk}' disk refused the write — check its credentials, bucket and endpoint");
            }
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }
    }

    private function raiseAlert(): void
    {
        $body = implode("\n", array_map(fn ($f) => '• '.$f, $this->failures));

        Log::critical('[backup] backup failed', ['failures' => $this->failures]);

        AdminAlert::raise(
            'backup_failed',
            'critical',
            'Backup failed',
            "The backup run at ".now()->timezone(config('app.business_timezone', 'Asia/Manila'))->format('M j, g:i A')
                ." (Manila) had problems:\n{$body}",
        );
    }

    /**
     * Delete backups older than $keepDays, keyed on the timestamp IN THE
     * FILENAME (not file mtime, which a copy/upload rewrites). Returns the
     * count removed.
     */
    public static function pruneOldBackups(string $disk, string $dir, int $keepDays): int
    {
        $cutoff = now()->subDays($keepDays);
        $deleted = 0;

        foreach (Storage::disk($disk)->files($dir) as $file) {
            if (! preg_match('/(\d{8})_(\d{6})\.(?:sql|tar)\.gz$/', $file, $m)) {
                continue;
            }

            $ts = Carbon::createFromFormat('Ymd_His', $m[1].'_'.$m[2]);
            if ($ts !== false && $ts->lessThan($cutoff)) {
                Storage::disk($disk)->delete($file);
                $deleted++;
            }
        }

        return $deleted;
    }

    private static function humanBytes(int $bytes): string
    {
        if ($bytes >= 1_048_576) {
            return round($bytes / 1_048_576, 1).' MB';
        }
        if ($bytes >= 1024) {
            return round($bytes / 1024, 1).' KB';
        }

        return $bytes.' B';
    }
}
