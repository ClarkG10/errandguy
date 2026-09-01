<?php

namespace App\Filament\Resources\SupportTickets\Pages;

use App\Filament\Resources\SupportTickets\Actions\SupportTicketActions;
use App\Filament\Resources\SupportTickets\SupportTicketResource;
use Filament\Resources\Pages\ViewRecord;

class ViewSupportTicket extends ViewRecord
{
    protected static string $resource = SupportTicketResource::class;

    /**
     * Closing a ticket from the screen where the thread was read, instead of
     * navigating back to the list to re-find the row. Same action object, same
     * canHandleSupport gate — see SupportTicketActions.
     */
    protected function getHeaderActions(): array
    {
        return SupportTicketActions::all();
    }
}
