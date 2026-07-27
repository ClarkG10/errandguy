<?php

namespace App\Filament\Resources\RunnerProfiles\Pages;

use App\Filament\Resources\RunnerProfiles\RunnerProfileResource;
use Filament\Resources\Pages\ListRecords;

class ListRunnerProfiles extends ListRecords
{
    protected static string $resource = RunnerProfileResource::class;

    protected function getHeaderActions(): array
    {
        return [];
    }
}
