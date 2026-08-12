<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\Process;

/**
 * Nightly logical backup of the database: a gzip'd mysqldump written to the
 * configured disk (config/backup.php), with retention pruning. This is the
 * disaster-recovery floor for a deploy pipeline that runs an irreversible
 * `migrate --force` behind no managed backup (audit's #1 critical).
 *
 * It is NOT point-in-time recovery — a logical dump loses everything written
 * since the last run. Managed PITR (binlog / provider snapshots) is still the
 * real answer; this bounds the blast radius in the meantime.
 *
 * Scheduled daily (routes/console.php). Local-disk backups live on the app
 * server — set DB_BACKUP_DISK=s3 for off-site copies.
 */
class BackupDatabase extends Command
{
    protected $signature = 'errandguy:backup-database {--keep-days= : Override config retention (days)}';

    protected $description = 'Write a gzip\'d mysqldump of the database to the backup disk and prune old dumps.';

    public function handle(): int
    {
        $connection = config('database.default');
        $driver = config("database.connections.{$connection}.driver");

        if ($driver !== 'mysql') {
            $this->error("Backups support the mysql driver only (current: {$driver}).");

            return self::FAILURE;
        }

        $cfg = config("database.connections.{$connection}");
        $disk = config('backup.disk', 'local');
        $dir = trim((string) config('backup.path', 'backups'), '/');
        $keepDays = (int) ($this->option('keep-days') ?? config('backup.retention_days', 7));

        $filename = ($cfg['database'] ?? 'database').'-'.now()->format('Ymd_His').'.sql.gz';
        $remotePath = $dir.'/'.$filename;

        $tmp = tempnam(sys_get_temp_dir(), 'egbackup_');

        try {
            // Two-step to keep the pipe's failure visible: `set -o pipefail` (via
            // an explicit bash, since /bin/sh on Ubuntu is dash) makes a failed
            // mysqldump fail the whole command instead of a valid gzip of nothing.
            // The password goes through MYSQL_PWD (env), never argv/process list.
            $pipeline = sprintf(
                'set -o pipefail; mysqldump --single-transaction --quick --no-tablespaces --host=%s --port=%s --user=%s %s | gzip > %s',
                escapeshellarg((string) ($cfg['host'] ?? '127.0.0.1')),
                escapeshellarg((string) ($cfg['port'] ?? '3306')),
                escapeshellarg((string) ($cfg['username'] ?? 'root')),
                escapeshellarg((string) ($cfg['database'] ?? '')),
                escapeshellarg($tmp),
            );

            $process = new Process(
                ['bash', '-c', $pipeline],
                null,
                ['MYSQL_PWD' => (string) ($cfg['password'] ?? '')],
                null,
                600,
            );
            $process->run();

            if (! $process->isSuccessful()) {
                $err = trim($process->getErrorOutput()) ?: 'mysqldump failed';
                $this->error("Backup failed: {$err}");
                Log::error('[db-backup] mysqldump failed', ['error' => $err]);

                return self::FAILURE;
            }

            $bytes = filesize($tmp) ?: 0;
            if ($bytes === 0) {
                $this->error('Backup failed: produced an empty file.');

                return self::FAILURE;
            }

            $stream = fopen($tmp, 'r');
            Storage::disk($disk)->writeStream($remotePath, $stream);
            if (is_resource($stream)) {
                fclose($stream);
            }
        } finally {
            if (is_file($tmp)) {
                @unlink($tmp);
            }
        }

        $pruned = self::pruneOldBackups($disk, $dir, $keepDays);

        $this->info(sprintf(
            'Backed up to %s:%s (%s). Pruned %d dump(s) older than %d day(s).',
            $disk, $remotePath, self::humanBytes($bytes), $pruned, $keepDays,
        ));

        return self::SUCCESS;
    }

    /**
     * Delete dumps older than $keepDays, keyed on the timestamp IN THE FILENAME
     * (not file mtime, which a copy/upload rewrites). Returns the count removed.
     */
    public static function pruneOldBackups(string $disk, string $dir, int $keepDays): int
    {
        $cutoff = now()->subDays($keepDays);
        $deleted = 0;

        foreach (Storage::disk($disk)->files($dir) as $file) {
            if (! preg_match('/(\d{8})_(\d{6})\.sql\.gz$/', $file, $m)) {
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
