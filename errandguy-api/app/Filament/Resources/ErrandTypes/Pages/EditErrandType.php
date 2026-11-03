<?php

namespace App\Filament\Resources\ErrandTypes\Pages;

use App\Filament\Resources\ErrandTypes\ErrandTypeResource;
use App\Models\ErrandType;
use App\Support\AdminActivity;
use Filament\Resources\Pages\EditRecord;
use Illuminate\Database\Eloquent\Model;

class EditErrandType extends EditRecord
{
    protected static string $resource = ErrandTypeResource::class;

    protected function getHeaderActions(): array
    {
        return [];
    }

    /**
     * Saves the edit and writes old → new for every changed field to the
     * audit log, so a price change always says who made it and what it was
     * before. Saving without a change logs nothing.
     *
     * @param  ErrandType  $record
     */
    protected function handleRecordUpdate(Model $record, array $data): Model
    {
        $record->fill($data);
        $dirty = $record->getDirty();

        if ($dirty === []) {
            return $record;
        }

        $old = array_intersect_key($record->getOriginal(), $dirty);
        $record->save();

        AdminActivity::log('catalog.updated', $record, [
            'slug' => $record->slug,
            'old' => $old,
            'new' => array_intersect_key($record->getAttributes(), $dirty),
        ], "Changed errand type {$record->name}");

        return $record;
    }
}
