<?php

namespace App\Filament\Support;

use App\Support\BusinessDay;
use Filament\Forms\Components\DatePicker;
use Filament\Tables\Filters\Filter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;

/**
 * Reusable "from / until" date-range table filter over a timestamp column.
 * The dates are Manila calendar days: "from Oct 31" starts at Manila midnight
 * (16:00 UTC the day before), since timestamps are stored in UTC.
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
                ->when($data['from'] ?? null, fn (Builder $q, $d): Builder => $q->where($column, '>=', BusinessDay::startOf(Carbon::parse($d)->toDateString())))
                ->when($data['until'] ?? null, fn (Builder $q, $d): Builder => $q->where($column, '<', BusinessDay::startOf(Carbon::parse($d)->toDateString())->addDay())))
            ->indicateUsing(function (array $data) use ($label): array {
                $out = [];
                if ($data['from'] ?? null) {
                    $out[] = $label.' from '.Carbon::parse($data['from'])->toFormattedDateString();
                }
                if ($data['until'] ?? null) {
                    $out[] = $label.' until '.Carbon::parse($data['until'])->toFormattedDateString();
                }

                return $out;
            });
    }
}
