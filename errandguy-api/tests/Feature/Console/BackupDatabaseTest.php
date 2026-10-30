<?php

namespace Tests\Feature\Console;

use App\Console\Commands\BackupDatabase;
use App\Models\AdminAlert;
use App\Support\Backup\DatabaseDumper;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\ExecutableFinder;
use Symfony\Component\Process\Process;
use Tests\TestCase;

/**
 * Backups: the database dump is always kept locally (what the deploy's migrate
 * step depends on), then the dump and an archive of the uploaded files (runner
 * ID documents, booking media) are copied off-site. A cloud failure never fails
 * the run — the local copy stands and staff get an AdminAlert. No real cloud
 * storage or MySQL is touched: the off-site disk is faked and the dumper is a
 * stand-in.
 */
class BackupDatabaseTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        Storage::fake('s3');
        Storage::fake('kyc');
        Storage::fake('media');

        $this->app->instance(DatabaseDumper::class, new class extends DatabaseDumper
        {
            public function databaseName(): string
            {
                return 'errandguy';
            }

            public function dump(string $path): void
            {
                file_put_contents($path, gzencode("-- fake dump\n"));
            }
        });
    }

    private function files(string $disk, string $pattern): array
    {
        return array_values(array_filter(
            Storage::disk($disk)->files('backups'),
            fn ($f) => preg_match($pattern, $f) === 1,
        ));
    }

    public function test_prunes_backups_older_than_retention_keying_on_the_filename_timestamp(): void
    {
        $oldDump = 'backups/errandguy-20200101_000000.sql.gz';
        $oldUploads = 'backups/uploads-20200101_000000.tar.gz';
        $recent = 'backups/errandguy-'.now()->format('Ymd_His').'.sql.gz';
        Storage::disk('local')->put($oldDump, 'x');
        Storage::disk('local')->put($oldUploads, 'x');
        Storage::disk('local')->put($recent, 'x');
        // A non-matching file must never be touched.
        Storage::disk('local')->put('backups/keep.txt', 'x');

        $deleted = BackupDatabase::pruneOldBackups('local', 'backups', 7);

        $this->assertSame(2, $deleted);
        Storage::disk('local')->assertMissing($oldDump);
        Storage::disk('local')->assertMissing($oldUploads);
        Storage::disk('local')->assertExists($recent);
        Storage::disk('local')->assertExists('backups/keep.txt');
    }

    public function test_the_real_dumper_refuses_a_non_mysql_connection(): void
    {
        if (DB::connection()->getDriverName() === 'mysql') {
            $this->markTestSkipped('This asserts the non-mysql guard.');
        }

        $this->expectExceptionMessage('mysql driver only');

        (new DatabaseDumper())->dump(tempnam(sys_get_temp_dir(), 'egtest_'));
    }

    public function test_a_failed_dump_fails_the_run_and_alerts_staff(): void
    {
        config(['backup.disk' => 's3']);
        $this->app->instance(DatabaseDumper::class, new class extends DatabaseDumper
        {
            public function dump(string $path): void
            {
                throw new \RuntimeException('mysqldump: access denied');
            }
        });
        Log::spy();

        $this->artisan('errandguy:backup-database')
            ->expectsOutputToContain('access denied')
            ->assertFailed();

        $this->assertSame([], Storage::disk('local')->allFiles());
        $this->assertSame([], Storage::disk('s3')->allFiles());
        $alert = AdminAlert::where('type', 'backup_failed')->firstOrFail();
        $this->assertSame('critical', $alert->severity);
        $this->assertStringContainsString('access denied', (string) $alert->body);
        Log::shouldHaveReceived('critical')->withArgs(fn ($message) => str_contains($message, '[backup]'));
    }

    public function test_dump_and_uploads_go_off_site_and_a_local_dump_is_kept(): void
    {
        if (! (new ExecutableFinder)->find('tar')) {
            $this->markTestSkipped('tar is not available on this host.');
        }

        config(['backup.disk' => 's3']);
        Storage::disk('kyc')->put('runner-documents/abc/id-front.jpg', 'ID');
        Storage::disk('media')->put('chat-images/'.str_repeat('a', 36).'/photo.jpg', 'PHOTO');

        $this->artisan('errandguy:backup-database')->assertSuccessful();

        // Database: local AND off-site.
        $this->assertCount(1, $this->files('local', '/errandguy-\d{8}_\d{6}\.sql\.gz$/'));
        $this->assertCount(1, $this->files('s3', '/errandguy-\d{8}_\d{6}\.sql\.gz$/'));

        // Uploads: off-site only (a nightly local copy of every upload would fill the disk).
        $this->assertCount(0, $this->files('local', '/uploads-.*\.tar\.gz$/'));
        $archives = $this->files('s3', '/uploads-\d{8}_\d{6}\.tar\.gz$/');
        $this->assertCount(1, $archives);

        $tmp = tempnam(sys_get_temp_dir(), 'egtest_');
        file_put_contents($tmp, Storage::disk('s3')->get($archives[0]));
        $list = new Process(['tar', '-tzf', $tmp]);
        $list->mustRun();
        @unlink($tmp);
        $this->assertStringContainsString('kyc/runner-documents/abc/id-front.jpg', $list->getOutput());
        $this->assertStringContainsString('media/chat-images/', $list->getOutput());

        $this->assertSame(0, AdminAlert::where('type', 'backup_failed')->count());
    }

    public function test_a_cloud_failure_keeps_local_copies_alerts_staff_and_does_not_fail_the_run(): void
    {
        if (! (new ExecutableFinder)->find('tar')) {
            $this->markTestSkipped('tar is not available on this host.');
        }

        config(['backup.disk' => 's3']);
        Storage::disk('kyc')->put('runner-documents/abc/id-front.jpg', 'ID');
        $refusing = \Mockery::mock(\Illuminate\Contracts\Filesystem\Filesystem::class);
        $refusing->shouldReceive('writeStream')->andReturn(false);
        $refusing->shouldReceive('files')->andReturn([]);
        Storage::set('s3', $refusing);
        Log::spy();

        // SUCCESS: the deploy's migrate step must still run.
        $this->artisan('errandguy:backup-database')->assertSuccessful();

        $this->assertCount(1, $this->files('local', '/errandguy-\d{8}_\d{6}\.sql\.gz$/'));
        $this->assertCount(1, $this->files('local', '/uploads-\d{8}_\d{6}\.tar\.gz$/'));

        $alert = AdminAlert::where('type', 'backup_failed')->firstOrFail();
        $this->assertSame('critical', $alert->severity);
        $this->assertStringContainsString("'s3'", (string) $alert->body);
        Log::shouldHaveReceived('critical')->withArgs(fn ($message) => str_contains($message, '[backup]'));
    }

    public function test_skip_files_backs_up_the_database_only(): void
    {
        config(['backup.disk' => 's3']);
        Storage::disk('kyc')->put('runner-documents/abc/id-front.jpg', 'ID');

        $this->artisan('errandguy:backup-database', ['--skip-files' => true])->assertSuccessful();

        $this->assertCount(1, $this->files('s3', '/\.sql\.gz$/'));
        $this->assertCount(0, $this->files('s3', '/\.tar\.gz$/'));
        $this->assertCount(0, $this->files('local', '/\.tar\.gz$/'));
    }

    public function test_local_only_mode_keeps_everything_on_this_server(): void
    {
        if (! (new ExecutableFinder)->find('tar')) {
            $this->markTestSkipped('tar is not available on this host.');
        }

        config(['backup.disk' => 'local']);
        Storage::disk('media')->put('chat-images/'.str_repeat('b', 36).'/photo.jpg', 'PHOTO');

        $this->artisan('errandguy:backup-database')
            ->expectsOutputToContain('No off-site backup disk')
            ->assertSuccessful();

        $this->assertCount(1, $this->files('local', '/\.sql\.gz$/'));
        $this->assertCount(1, $this->files('local', '/uploads-.*\.tar\.gz$/'));
        $this->assertSame([], Storage::disk('s3')->allFiles());
    }

    public function test_only_the_newest_local_uploads_archive_is_kept(): void
    {
        if (! (new ExecutableFinder)->find('tar')) {
            $this->markTestSkipped('tar is not available on this host.');
        }

        config(['backup.disk' => 'local']);
        Storage::disk('media')->put('chat-images/'.str_repeat('c', 36).'/photo.jpg', 'PHOTO');
        $yesterday = 'backups/uploads-'.now()->subDay()->format('Ymd_His').'.tar.gz';
        Storage::disk('local')->put($yesterday, 'old archive');

        $this->artisan('errandguy:backup-database')->assertSuccessful();

        Storage::disk('local')->assertMissing($yesterday);
        $this->assertCount(1, $this->files('local', '/uploads-.*\.tar\.gz$/'));
    }

    public function test_a_successful_offsite_copy_clears_old_local_uploads_archives(): void
    {
        if (! (new ExecutableFinder)->find('tar')) {
            $this->markTestSkipped('tar is not available on this host.');
        }

        config(['backup.disk' => 's3']);
        Storage::disk('media')->put('chat-images/'.str_repeat('d', 36).'/photo.jpg', 'PHOTO');
        $fallback = 'backups/uploads-'.now()->subDay()->format('Ymd_His').'.tar.gz';
        Storage::disk('local')->put($fallback, 'from a night the bucket was down');

        $this->artisan('errandguy:backup-database')->assertSuccessful();

        Storage::disk('local')->assertMissing($fallback);
        $this->assertCount(1, $this->files('s3', '/uploads-.*\.tar\.gz$/'));
    }

    public function test_an_upload_disk_already_in_the_cloud_is_not_archived(): void
    {
        config(['filesystems.disks.kyc.driver' => 's3']);

        $roots = BackupDatabase::uploadSources();

        $this->assertCount(1, $roots);
        $this->assertStringEndsWith('media', $roots[0]);
    }

    public function test_the_nightly_backup_runs_at_half_past_two_manila_time(): void
    {
        $event = collect(app(Schedule::class)->events())
            ->first(fn ($event) => str_contains((string) $event->command, 'errandguy:backup-database'));

        $this->assertNotNull($event);
        $this->assertSame('30 2 * * *', $event->expression);
        $this->assertSame('Asia/Manila', $event->timezone);
        // 02:30 in Manila is 18:30 UTC the day before — not 10:30 in the morning.
        $this->assertSame('18:30', $event->nextRunDate(now('UTC'))->setTimezone('UTC')->format('H:i'));
    }

    public function test_daily_maintenance_runs_in_the_manila_night(): void
    {
        $daily = collect(app(Schedule::class)->events())
            ->filter(fn ($event) => preg_match('/^\d+ \d+ \* \* \*$/', $event->expression) === 1);

        $this->assertNotEmpty($daily);
        foreach ($daily as $event) {
            $this->assertSame('Asia/Manila', $event->timezone, (string) ($event->command ?? $event->description));
            [, $hour] = explode(' ', $event->expression);
            $this->assertTrue(
                ((int) $hour >= 2 && (int) $hour <= 4) || str_contains((string) $event->command, 'onboarding-reminders'),
                'Daily task outside the 02:00–04:59 Manila window: '.$event->command,
            );
        }
    }
}
