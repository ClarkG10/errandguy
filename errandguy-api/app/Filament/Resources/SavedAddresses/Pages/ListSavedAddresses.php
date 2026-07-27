<?php

namespace App\Filament\Resources\SavedAddresses\Pages;

use App\Filament\Resources\SavedAddresses\SavedAddressResource;
use Filament\Resources\Pages\ListRecords;

class ListSavedAddresses extends ListRecords
{
    protected static string $resource = SavedAddressResource::class;

    protected function getHeaderActions(): array
    {
        return [];
    }
}
