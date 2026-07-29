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

    public function getTabs(): array
    {
        $c = ListTabs::counts('sos', SOSAlert::class, 'status');

        return [
            'all' => Tab::make('All')->badge(array_sum($c)),
            'active' => Tab::make('Active')->icon('heroicon-m-shield-exclamation')->badgeColor('danger')
                ->badge(ListTabs::sum($c, 'active'))
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->where('status', 'active')),
            'resolved' => Tab::make('Resolved')->icon('heroicon-m-check-circle')->badgeColor('success')
                ->badge(ListTabs::sum($c, 'resolved'))
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->where('status', 'resolved')),
        ];
    }
}
