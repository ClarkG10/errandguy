<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

/**
 * One-shot LAUNCH GATE. Aggregates the go-live readiness checks into a single
 * pass/fail so a deploy step (or a human before flipping DNS) gets a definitive
 * "these criticals block launch" answer instead of relying on tribal knowledge.
 *
 * It composes {@see CheckProductionConfig} (env/config hygiene: APP_DEBUG,
 * broadcast, cache, queue, trusted proxies, Sentry DSN, Reverb creds, APP_URL)
 * with RUNTIME state the config check cannot see:
 *   - pending migrations (code deployed ahead of schema),
 *   - whether the scheduler is actually beating (cron alive?),
 *   - whether backups leave the box.
 *
 * Exit code is non-zero when ANY critical fails, so `php artisan
 * errandguy:preflight` can gate a deploy / CI job. Read-only; never mutates.
 */
class Preflight extends Command
{
    protected $signature = 'errandguy:preflight';

    protected $description = 'Launch-readiness gate: config hygiene + migrations + scheduler + backups. Non-zero exit on any critical.';

    public function handle(): int
    {
        $results = self::checks();

        $rows = [];
        foreach ($results as $r) {
            $rows[] = [
                strtoupper($r['level']),
                $r['ok'] ? '<info>PASS</info>' : '<comment>FAIL</comment>',
                $r['check'],
                $r['message'],
            ];
        }
        $this->table(['Level', 'Status', 'Check', 'Detail'], $rows);

        $failedCriticals = array_filter($results, fn ($r) => ! $r['ok'] && $r['level'] === 'critical');
        $failedWarnings = array_filter($results, fn ($r) => ! $r['ok'] && $r['level'] === 'warning');

        if ($failedCriticals !== []) {
            $this->error(count($failedCriticals).' critical check(s) FAILED — NOT launch-ready.');

            return self::FAILURE;
        }

        if ($failedWarnings !== []) {
            $this->warn(count($failedWarnings).' warning(s) — launchable, but review before go-live.');

            return self::SUCCESS;
        }

        $this->info('All preflight checks passed — launch-ready.');

        return self::SUCCESS;
    }

    /**
     * Pure-ish detection over the current config + runtime state. Kept static and
     * side-effect-free (read-only) so it is unit-testable without faking a full
     * boot.
     *
     * @return array<int, array{check: string, level: string, ok: bool, message: string}>
     */
    public static function checks(): array
    {
        $results = [];

        // 1. Config hygiene — fold in the existing detector. A clean config is one
        //    PASS row; each detected issue is a FAILED row at its own level.
        $configIssues = CheckProductionConfig::detect();
        if ($configIssues === []) {
            $results[] = ['check' => 'config hygiene', 'level' => 'critical', 'ok' => true, 'message' => 'No unsafe/degraded config detected.'];
        } else {
            foreach ($configIssues as $issue) {
                $results[] = [
                    'check' => 'config: '.self::configTag($issue['message']),
                    'level' => $issue['level'],
                    'ok' => false,
                    'message' => $issue['message'],
                ];
            }
        }

        // 2. Pending migrations — code deployed ahead of schema means missing
        //    columns/tables and 500s on the hot path. Critical.
        $results[] = self::migrationsCheck();

        // 3. Scheduler liveness — the daily backup, config-check, cleanup jobs and
        //    safety monitors all ride the scheduler; if cron isn't running, none of
        //    them do. Mirrors HealthController::schedulerStatus (heartbeat every
        //    minute; >180s = 3 missed beats).
        $results[] = self::schedulerCheck();

        // 4. Off-box backups — an on-box ('local') backup disk is lost with the
        //    server it lives on. Warning (launchable, but a real DR gap).
        $disk = config('backup.disk', 'local');
        $offBox = ! in_array($disk, ['local', '', null], true);
        $results[] = [
            'check' => 'off-box backups',
            'level' => 'warning',
            'ok' => $offBox,
            'message' => $offBox
                ? "Backups write to the '{$disk}' disk (off-box)."
                : "DB_BACKUP_DISK='".($disk ?: 'local')."' — backups stay on the app server; a lost box loses them too. Set an off-site disk (e.g. s3) + AWS_*.",
        ];

        return $results;
    }

    private static function migrationsCheck(): array
    {
        try {
            $migrator = app('migrator');

            if (! $migrator->repositoryExists()) {
                return ['check' => 'migrations', 'level' => 'critical', 'ok' => false, 'message' => 'The migration repository does not exist — run php artisan migrate.'];
            }

            $ran = $migrator->getRepository()->getRan();
            $paths = array_merge($migrator->paths(), [database_path('migrations')]);
            $files = $migrator->getMigrationFiles($paths);
            $pending = array_diff(array_keys($files), $ran);
            $count = count($pending);

            return [
                'check' => 'migrations',
                'level' => 'critical',
                'ok' => $count === 0,
                'message' => $count === 0
                    ? 'Schema is up to date.'
                    : "{$count} pending migration(s) — run php artisan migrate before serving traffic.",
            ];
        } catch (\Throwable $e) {
            return ['check' => 'migrations', 'level' => 'critical', 'ok' => false, 'message' => 'Could not determine migration status: '.$e->getMessage()];
        }
    }

    private static function schedulerCheck(): array
    {
        try {
            $ts = Cache::get('scheduler:heartbeat');

            // No heartbeat yet is inconclusive (fresh boot vs. dead cron), so it is
            // a WARNING; a STALE heartbeat proves the cron stopped, so it is CRITICAL.
            if ($ts === null) {
                return ['check' => 'scheduler', 'level' => 'warning', 'ok' => false, 'message' => 'No scheduler heartbeat yet — if this persists, the per-minute cron (php artisan schedule:run) is not running.'];
            }

            $stale = (now()->timestamp - (int) $ts) > 180;

            return [
                'check' => 'scheduler',
                'level' => 'critical',
                'ok' => ! $stale,
                'message' => $stale
                    ? 'Scheduler heartbeat is STALE (>3 min old) — the cron stopped; backups, safety monitors and cleanups are NOT running.'
                    : 'Scheduler heartbeat is fresh (cron alive).',
            ];
        } catch (\Throwable $e) {
            return ['check' => 'scheduler', 'level' => 'warning', 'ok' => false, 'message' => 'Could not read the scheduler heartbeat: '.$e->getMessage()];
        }
    }

    /** Compact label from the first token of a config-issue message (e.g. "APP_DEBUG"). */
    private static function configTag(string $message): string
    {
        $first = strtok($message, ' =') ?: 'setting';

        return strtolower(trim($first, "'\""));
    }
}
