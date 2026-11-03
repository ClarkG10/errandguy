<?php

namespace Tests\Feature\Admin;

use App\Filament\Support\ExportCsv;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * Exports show times in Manila time, like the panel, and say so in the
 * column header — a sheet compared against UTC data would otherwise be 8
 * hours off with no hint.
 */
class ExportCsvTimezoneTest extends TestCase
{
    private function invokeExport(string $method, mixed ...$args): mixed
    {
        $m = new \ReflectionMethod(ExportCsv::class, $method);

        return $m->invoke(null, ...$args);
    }

    public function test_times_are_written_and_labelled_in_manila_time(): void
    {
        $row = (object) ['at' => Carbon::parse('2026-11-03 13:05:00', 'UTC'), 'name' => 'Juan'];
        $columns = [
            'Created' => fn ($r) => $r->at,
            'Name' => fn ($r) => $r->name,
        ];

        $this->assertSame(['Created (Manila time)', 'Name'], $this->invokeExport('headers', $columns, $row));
        $this->assertSame('2026-11-03 21:05:00', $this->invokeExport('stringify', $row->at));
        // No rows: plain headers, nothing evaluated.
        $this->assertSame(['Created', 'Name'], $this->invokeExport('headers', $columns, null));
    }
}
