<?php

namespace App\Filament\Resources\ErrandTypes\Pages;

use App\Filament\Resources\ErrandTypes\ErrandTypeResource;
use Filament\Actions\DeleteAction;
use Filament\Resources\Pages\EditRecord;

class EditErrandType extends EditRecord
{
    protected static string $resource = ErrandTypeResource::class;

    protected function getHeaderActions(): array
    {
        return [
            DeleteAction::make(),
        ];
    }
}
