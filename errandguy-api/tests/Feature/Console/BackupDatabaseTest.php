<?php

namespace Tests\Feature\Console;

use App\Console\Commands\BackupDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\ExecutableFinder;
use Tests\TestCase;

class BackupDatabaseTest extends TestCase
{
    public function test_prunes_dumps_older_than_retention_keying_on_the_filename_timestamp(): void
    {
        Storage::fake('local');
        $old = 'backups/errandguy-20200101_000000.sql.gz';
        $recent = 'backups/errandguy-'.now()->format('Ymd_His').'.sql.gz';
        Storage::disk('local')->put($old, 'x');
        Storage::disk('local')->put($recent, 'x');
        // A non-matching file must never be touched.
        Storage::disk('local')->put('backups/keep.txt', 'x');

        $deleted = BackupDatabase::pruneOldBackups('local', 'backups', 7);

        $this->assertSame(1, $deleted);
        Storage::disk('local')->assertMissing($old);
        Storage::disk('local')->assertExists($recent);
        Storage::disk('local')->assertExists('backups/keep.txt');
    }

    public function test_refuses_to_run_on_a_non_mysql_connection(): void
    {
        if (DB::connection()->getDriverName() === 'mysql') {
            $this->markTestSkipped('This asserts the non-mysql guard; the mysql path is covered separately.');
        }

        $this->artisan('errandguy:backup-database')
            ->expectsOutputToContain('mysql driver only')
            ->assertFailed();
    }

    public function test_creates_a_non_empty_gzipped_dump_on_mysql(): void
    {
        if (DB::connection()->getDriverName() !== 'mysql') {
            $this->markTestSkipped('Real mysqldump only runs against the MySQL suite.');
        }
        if (! (new ExecutableFinder)->find('mysqldump')) {
            $this->markTestSkipped('mysqldump binary not available on this host.');
        }

        Storage::fake('local'); // backup disk defaults to 'local'

        $this->artisan('errandguy:backup-database')->assertSuccessful();

        $files = Storage::disk('local')->files('backups');
        $this->assertCount(1, $files);
        $this->assertMatchesRegularExpression('/\.sql\.gz$/', $files[0]);
        $this->assertGreaterThan(0, Storage::disk('local')->size($files[0]));
    }
}
