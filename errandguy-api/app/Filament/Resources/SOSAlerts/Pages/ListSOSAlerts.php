<?php

namespace App\Filament\Resources\SOSAlerts\Pages;

use App\Filament\Resources\SOSAlerts\SOSAlertResource;
use App\Filament\Support\ListTabs;
use App\Models\SOSAlert;
use Filament\Resources\Pages\ListRecords;
use Filament\Schemas\Components\Tabs\Tab;
use Illuminate\Database\Eloquent\Builder;

class ListSOSAlerts extends ListRecords
{
    protected static string $resource = SOSAlertResource::class;

    /**
     * Open alerts first. (This used to be a default status filter, which
     * stacked on the tabs and left Resolved and Cancelled always empty.)
     */
    public function getDefaultActiveTab(): string|int|null
    {
        return 'active';
    }

    public function getTabs(): array
    {
        $c = ListTabs::counts('sos', SOSAlert::class, 'status');

        return [
            'all' => Tab::make('All')->badge(array_sum($c)),
            'active' => Tab::make('Active')->icon('heroicon-m-shield-exclamation')->badgeColor('danger')
                ->badge(ListTabs::sum($c, 'active'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('status', 'active')),
            'resolved' => Tab::make('Resolved')->icon('heroicon-m-check-circle')->badgeColor('success')
                ->badge(ListTabs::sum($c, 'resolved'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('status', 'resolved')),
            'cancelled' => Tab::make('Cancelled by them')->icon('heroicon-m-x-circle')
                ->badge(ListTabs::sum($c, 'cancelled'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('status', 'cancelled')),
        ];
    }
}
