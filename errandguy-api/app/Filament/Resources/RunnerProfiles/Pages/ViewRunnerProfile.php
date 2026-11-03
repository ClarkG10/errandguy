<?php

namespace App\Filament\Resources\RunnerProfiles\Pages;

use App\Filament\Resources\RunnerProfiles\RunnerProfileResource;
use App\Filament\Resources\RunnerProfiles\Tables\RunnerProfilesTable;
use Filament\Resources\Pages\ViewRecord;

class ViewRunnerProfile extends ViewRecord
{
    protected static string $resource = RunnerProfileResource::class;

    /**
     * Approve or reject from the page where the documents are reviewed — the
     * same actions and role gates as the list row.
     */
    protected function getHeaderActions(): array
    {
        return [
            RunnerProfilesTable::approveAction(),
            RunnerProfilesTable::rejectAction(),
        ];
    }
}
