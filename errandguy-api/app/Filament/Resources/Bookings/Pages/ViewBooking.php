<?php

namespace App\Filament\Resources\Bookings\Pages;

use App\Filament\Resources\Bookings\Actions\BookingActions;
use App\Filament\Resources\Bookings\BookingResource;
use Filament\Resources\Pages\ViewRecord;
use Filament\Schemas\Components\Component;
use Illuminate\Database\Eloquent\Model;

class ViewBooking extends ViewRecord
{
    protected static string $resource = BookingResource::class;

    /**
     * A booking is "live" until it reaches a terminal status. While live we
     * poll the detail view so admins watching an active incident see status,
     * runner assignment and payment changes without a manual refresh. Terminal
     * bookings never change again, so we stop polling to avoid needless load.
     */
    private const TERMINAL_STATUSES = ['completed', 'cancelled', 'no_runner'];

    /**
     * Cancel, re-run matching, return to matching and mark completed, from
     * the page where staff read the errand — the same action objects and role
     * gates as the list row (BookingActions).
     */
    protected function getHeaderActions(): array
    {
        return BookingActions::all();
    }

    /**
     * Load what the page shows in one go. The chat tab read each message's
     * sender one query at a time, again on every 15-second refresh of a live
     * errand.
     */
    protected function resolveRecord(int|string $key): Model
    {
        return parent::resolveRecord($key)->load(['messages.sender:id,full_name', 'payment']);
    }

    /**
     * How often to refresh while the booking is active, or null once it is
     * terminal (no polling). Mirrors the widget polling cadence already used
     * across the panel (e.g. ActionQueue's '30s').
     */
    protected function getPollingInterval(): ?string
    {
        return in_array($this->getRecord()->status, self::TERMINAL_STATUSES, true)
            ? null
            : '15s';
    }

    /**
     * Attach the polling interval to the infolist content component. This is
     * the supported hook in this Filament v4 build: ViewRecord has no
     * page-level getPollingInterval(), so polling lives on the schema
     * component (CanPoll::poll → wire:poll). poll(null) disables it cleanly.
     */
    public function getInfolistContentComponent(): Component
    {
        return parent::getInfolistContentComponent()
            ->poll($this->getPollingInterval());
    }
}
