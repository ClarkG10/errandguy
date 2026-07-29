<?php

namespace App\Filament\Support;

use Filament\Forms\Components\DatePicker;
use Filament\Tables\Filters\Filter;
use Illuminate\Database\Eloquent\Builder;

/**
 * Reusable "from / until" date-range table filter over a timestamp column.
 *
 * Usage:
 *   ->filters([ DateRangeFilter::make('created_at', 'Date placed') ])
 */
class DateRangeFilter
{
    public static function make(string $column = 'created_at', ?string $label = null): Filter
    {
        $label ??= ucfirst(str_replace('_', ' ', $column));

        return Filter::make($column.'_range')
            ->schema([
                DatePicker::make('from')->label($label.' from')->native(false)->closeOnDateSelection(),
                DatePicker::make('until')->label($label.' until')->native(false)->closeOnDateSelection(),
            ])
            ->columns(2)
            ->query(fn (Builder $query, array $data): Builder => $query
                ->when($data['from'] ?? null, fn (Builder $q, $d): Builder => $q->whereDate($column, '>=', $d))
                ->when($data['until'] ?? null, fn (Builder $q, $d): Builder => $q->whereDate($column, '<=', $d)))
            ->indicateUsing(function (array $data) use ($label): array {
                $out = [];
                if ($data['from'] ?? null) {
                    $out[] = $label.' from '.\Illuminate\Support\Carbon::parse($data['from'])->toFormattedDateString();
                }
                if ($data['until'] ?? null) {
                    $out[] = $label.' until '.\Illuminate\Support\Carbon::parse($data['until'])->toFormattedDateString();
                }

                return $out;
            });
    }
}
