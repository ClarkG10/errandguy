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
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->where('verification_status', 'pending')),
            'approved' => Tab::make('Approved')->icon('heroicon-m-shield-check')->badgeColor('success')
                ->badge(ListTabs::sum($c, 'approved'))
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->where('verification_status', 'approved')),
            'rejected' => Tab::make('Rejected')->icon('heroicon-m-shield-exclamation')->badgeColor('danger')
                ->badge(ListTabs::sum($c, 'rejected'))
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->where('verification_status', 'rejected')),
            'online' => Tab::make('Online now')->icon('heroicon-m-signal')
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->where('is_online', true)),
        ];
    }
}
