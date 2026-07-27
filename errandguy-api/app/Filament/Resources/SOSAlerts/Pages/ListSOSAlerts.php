<?php

namespace App\Filament\Resources\SOSAlerts\Pages;

use App\Filament\Resources\SOSAlerts\SOSAlertResource;
use Filament\Resources\Pages\ListRecords;

class ListSOSAlerts extends ListRecords
{
    protected static string $resource = SOSAlertResource::class;

    protected function getHeaderActions(): array
    {
        return [];
    }
}
