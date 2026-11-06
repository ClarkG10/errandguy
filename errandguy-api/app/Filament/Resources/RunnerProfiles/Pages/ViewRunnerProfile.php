<?php

namespace App\Filament\Resources\RunnerProfiles\Pages;

use App\Filament\Resources\RunnerProfiles\RunnerProfileResource;
use App\Filament\Resources\RunnerProfiles\Tables\RunnerProfilesTable;
use Filament\Resources\Pages\ViewRecord;
use Illuminate\Contracts\Support\Htmlable;
use Livewire\Attributes\On;

class ViewRunnerProfile extends ViewRecord
{
    protected static string $resource = RunnerProfileResource::class;

    /** The runner's name, not "Runner Profile", in the title and breadcrumb. */
    public function getRecordTitle(): string|Htmlable
    {
        return $this->getRecord()->user?->full_name ?? RunnerProfileResource::getTitleCaseModelLabel();
    }

    /**
     * Approve or reject from the page where the documents are reviewed — the
     * same actions and role gates as the list row. Here Approve also shows
     * while the documents still need review (greyed, saying why), so staff
     * aren't left with only "Reject" and no idea why.
     */
    protected function getHeaderActions(): array
    {
        return [
            RunnerProfilesTable::approveAction(explainWhenBlocked: true),
            RunnerProfilesTable::rejectAction(),
        ];
    }

    /**
     * A document approved or rejected in the Documents tab (its own Livewire
     * component) re-reads the profile, so Approve runner unlocks without a
     * page reload — it reads the approved-document count loaded with the page.
     */
    #[On('runner-documents-reviewed')]
    public function refreshAfterDocumentReview(): void
    {
        $this->record = $this->resolveRecord($this->getRecord()->getKey());
    }
}
