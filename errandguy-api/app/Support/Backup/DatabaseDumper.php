<?php

namespace App\Support\Backup;

use Symfony\Component\Process\Process;

/**
 * Writes a gzip'd mysqldump of the default connection to a local file. Its own
 * class so the backup command can be exercised without a MySQL server (tests
 * bind a fake).
 */
class DatabaseDumper
{
    /** The database name, for the dump's filename. */
    public function databaseName(): string
    {
        $connection = config('database.default');

        return (string) (config("database.connections.{$connection}.database") ?: 'database');
    }

    /**
     * @throws \RuntimeException when the driver isn't mysql or the dump fails
     */
    public function dump(string $path): void
    {
        $connection = config('database.default');
        $cfg = (array) config("database.connections.{$connection}");
        $driver = $cfg['driver'] ?? null;

        if ($driver !== 'mysql') {
            throw new \RuntimeException("Backups support the mysql driver only (current: {$driver}).");
        }

        // `set -o pipefail` (via an explicit bash, since /bin/sh on Ubuntu is
        // dash) makes a failed mysqldump fail the whole command instead of
        // producing a valid gzip of nothing. The password goes through
        // MYSQL_PWD (env), never argv / the process list.
        $pipeline = sprintf(
            'set -o pipefail; mysqldump --single-transaction --quick --no-tablespaces --host=%s --port=%s --user=%s %s | gzip > %s',
            escapeshellarg((string) ($cfg['host'] ?? '127.0.0.1')),
            escapeshellarg((string) ($cfg['port'] ?? '3306')),
            escapeshellarg((string) ($cfg['username'] ?? 'root')),
            escapeshellarg((string) ($cfg['database'] ?? '')),
            escapeshellarg($path),
        );

        $process = new Process(['bash', '-c', $pipeline], null, ['MYSQL_PWD' => (string) ($cfg['password'] ?? '')], null, 600);
        $process->run();

        if (! $process->isSuccessful()) {
            throw new \RuntimeException(trim($process->getErrorOutput()) ?: 'mysqldump failed');
        }

        if ((int) @filesize($path) === 0) {
            throw new \RuntimeException('mysqldump produced an empty file');
        }
    }
}
