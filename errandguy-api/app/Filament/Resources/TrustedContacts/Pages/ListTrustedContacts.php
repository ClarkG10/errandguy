<?php

namespace App\Filament\Resources\TrustedContacts\Pages;

use App\Filament\Resources\TrustedContacts\TrustedContactResource;
use Filament\Resources\Pages\ListRecords;

class ListTrustedContacts extends ListRecords
{
    protected static string $resource = TrustedContactResource::class;

    protected function getHeaderActions(): array
    {
        return [];
    }
}
