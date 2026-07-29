<?php

namespace App\Filament\Resources\Users\Pages;

use App\Filament\Resources\Users\UserResource;
use App\Filament\Support\ListTabs;
use App\Models\User;
use Filament\Resources\Pages\ListRecords;
use Filament\Schemas\Components\Tabs\Tab;
use Illuminate\Database\Eloquent\Builder;

class ListUsers extends ListRecords
{
    protected static string $resource = UserResource::class;

    public function getTabs(): array
    {
        $roles = ListTabs::counts('users_role', User::class, 'role');
        $status = ListTabs::counts('users_status', User::class, 'status');

        return [
            'all' => Tab::make('All')->badge(array_sum($roles)),
            'customers' => Tab::make('Customers')->icon('heroicon-m-user')->badgeColor('gray')
                ->badge(ListTabs::sum($roles, 'customer'))
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->where('role', 'customer')),
            'runners' => Tab::make('Runners')->icon('heroicon-m-truck')->badgeColor('info')
                ->badge(ListTabs::sum($roles, 'runner'))
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->where('role', 'runner')),
            'suspended' => Tab::make('Suspended')->icon('heroicon-m-shield-exclamation')->badgeColor('danger')
                ->badge(ListTabs::sum($status, 'suspended'))
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->where('status', 'suspended')),
        ];
    }
}
