<?php

namespace App\Filament\Resources\Reviews\Pages;

use App\Filament\Resources\Reviews\ReviewResource;
use App\Filament\Support\ListTabs;
use App\Models\Review;
use Filament\Resources\Pages\ListRecords;
use Filament\Schemas\Components\Tabs\Tab;
use Illuminate\Database\Eloquent\Builder;

class ListReviews extends ListRecords
{
    protected static string $resource = ReviewResource::class;

    protected function getHeaderActions(): array
    {
        return [];
    }

    public function getTabs(): array
    {
        $c = ListTabs::counts('reviews_flagged', Review::class, 'is_flagged');

        return [
            'all' => Tab::make('All')->badge(array_sum($c)),
            'flagged' => Tab::make('Flagged')->icon('heroicon-m-exclamation-triangle')->badgeColor('warning')
                // is_flagged is a boolean; pass every representation the driver
                // might key the grouped count by (int 1, 't', 'true') — only the
                // matching one exists, the rest resolve to 0 in ListTabs::sum.
                ->badge(ListTabs::sum($c, '1', 't', 'true'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('is_flagged', true)),
        ];
    }
}
