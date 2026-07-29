<?php

namespace App\Filament\Support;

use App\Support\AdminActivity;
use Filament\Actions\Action;
use Filament\Support\Icons\Heroicon;
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
 * @param  array<string, callable>  $columns  header => fn($record) => scalar
 */
class ExportCsv
{
    public static function make(string $filenameBase, array $columns): Action
    {
        return Action::make('exportCsv')
            ->label('Export CSV')
            ->icon(Heroicon::OutlinedArrowDownTray)
            ->color('gray')
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
                    fputcsv($out, array_keys($columns));

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

    private static function stringify(mixed $value): string
    {
        if ($value === null) {
            return '';
        }
        if ($value instanceof \Illuminate\Support\Carbon || $value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d H:i:s');
        }
        if (is_bool($value)) {
            return $value ? 'yes' : 'no';
        }
        if (is_array($value)) {
            return implode(' | ', $value);
        }

        return (string) $value;
    }
}
