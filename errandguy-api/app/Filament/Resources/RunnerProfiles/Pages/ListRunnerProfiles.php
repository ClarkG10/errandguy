<?php

namespace App\Filament\Resources\RunnerProfiles\Pages;

use App\Filament\Resources\RunnerProfiles\RunnerProfileResource;
use App\Filament\Support\ListTabs;
use App\Models\RunnerProfile;
use Filament\Resources\Pages\ListRecords;
use Filament\Schemas\Components\Tabs\Tab;
use Illuminate\Database\Eloquent\Builder;

class ListRunnerProfiles extends ListRecords
{
    protected static string $resource = RunnerProfileResource::class;

    public function getTabs(): array
    {
        $c = ListTabs::counts('runners', RunnerProfile::class, 'verification_status');

        return [
            'all' => Tab::make('All')->badge(array_sum($c)),
            'pending' => Tab::make('Pending')->icon('heroicon-m-clock')->badgeColor('warning')
                ->badge(ListTabs::sum($c, 'pending'))
                // SLA queue: oldest application on top so the longest-waiting
                // runner is reviewed first. The asc order is applied to the base
                // query before the table's default created_at,desc, and being the
                // first orderBy clause on the same column it wins.
                ->modifyQueryUsing(fn (Builder $query): Builder => $query
                    ->where('verification_status', 'pending')
                    ->orderBy('created_at', 'asc')),
            'approved' => Tab::make('Approved')->icon('heroicon-m-shield-check')->badgeColor('success')
                ->badge(ListTabs::sum($c, 'approved'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('verification_status', 'approved')),
            'rejected' => Tab::make('Rejected')->icon('heroicon-m-shield-exclamation')->badgeColor('danger')
                ->badge(ListTabs::sum($c, 'rejected'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('verification_status', 'rejected')),
            'online' => Tab::make('Online now')->icon('heroicon-m-signal')
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('is_online', true)),
        ];
    }
}
