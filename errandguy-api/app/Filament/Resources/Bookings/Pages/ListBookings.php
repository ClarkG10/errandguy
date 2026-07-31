<?php

namespace App\Filament\Resources\Bookings\Pages;

use App\Filament\Resources\Bookings\BookingResource;
use App\Filament\Support\ListTabs;
use App\Models\Booking;
use Filament\Resources\Pages\ListRecords;
use Filament\Schemas\Components\Tabs\Tab;
use Illuminate\Database\Eloquent\Builder;

class ListBookings extends ListRecords
{
    protected static string $resource = BookingResource::class;

    protected function getHeaderWidgets(): array
    {
        return [\App\Filament\Resources\Bookings\Widgets\BookingListStats::class];
    }

    public function getTabs(): array
    {
        $c = ListTabs::counts('bookings', Booking::class, 'status');

        return [
            'all' => Tab::make('All')->badge(array_sum($c)),
            'active' => Tab::make('Active')->icon('heroicon-m-bolt')->badgeColor('info')
                ->badge(ListTabs::sum($c, 'pending', 'matched', 'accepted', 'heading_to_pickup', 'arrived_at_pickup', 'picked_up', 'in_transit', 'arrived_at_dropoff', 'delivered'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->whereNotIn('status', ['completed', 'cancelled', 'no_runner'])),
            'completed' => Tab::make('Completed')->icon('heroicon-m-check-circle')->badgeColor('success')
                ->badge(ListTabs::sum($c, 'completed'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('status', 'completed')),
            'cancelled' => Tab::make('Cancelled')->icon('heroicon-m-x-circle')->badgeColor('danger')
                ->badge(ListTabs::sum($c, 'cancelled', 'no_runner'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->whereIn('status', ['cancelled', 'no_runner'])),
        ];
    }
}
