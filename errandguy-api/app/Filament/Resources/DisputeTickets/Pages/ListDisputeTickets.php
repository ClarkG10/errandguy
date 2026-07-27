<?php

namespace App\Filament\Resources\DisputeTickets\Pages;

use App\Filament\Resources\DisputeTickets\DisputeTicketResource;
use Filament\Resources\Pages\ListRecords;

class ListDisputeTickets extends ListRecords
{
    protected static string $resource = DisputeTicketResource::class;

    protected function getHeaderActions(): array
    {
        return [];
    }
}
