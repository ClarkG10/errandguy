<?php

namespace App\Filament\Resources\ErrandTypes\Pages;

use App\Filament\Resources\ErrandTypes\ErrandTypeResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListErrandTypes extends ListRecords
{
    protected static string $resource = ErrandTypeResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make(),
        ];
    }
}
