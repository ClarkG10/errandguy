<?php

namespace App\Filament\Resources\DisputeTickets\Pages;

use App\Filament\Resources\DisputeTickets\Actions\DisputeTicketActions;
use App\Filament\Resources\DisputeTickets\DisputeTicketResource;
use Filament\Resources\Pages\ViewRecord;

class ViewDisputeTicket extends ViewRecord
{
    protected static string $resource = DisputeTicketResource::class;

    /**
     * The decision belongs on the screen that carries the evidence. These are
     * the SAME action objects the list row mounts (same role gates, same
     * refundability tooltip) — see DisputeTicketActions.
     */
    protected function getHeaderActions(): array
    {
        return DisputeTicketActions::all();
    }
}
