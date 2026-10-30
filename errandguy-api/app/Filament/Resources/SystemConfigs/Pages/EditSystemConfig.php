<?php

namespace App\Filament\Resources\SystemConfigs\Pages;

use App\Filament\Resources\SystemConfigs\SystemConfigResource;
use App\Models\SystemConfig;
use App\Support\AdminActivity;
use Filament\Resources\Pages\EditRecord;
use Illuminate\Database\Eloquent\Model;

class EditSystemConfig extends EditRecord
{
    protected static string $resource = SystemConfigResource::class;

    protected function getHeaderActions(): array
    {
        return [];
    }

    /**
     * Saves only the value (already checked and tidied by the form), stamps
     * who changed it, and writes old → new to the audit log. Saving the same
     * value again changes nothing and logs nothing.
     *
     * @param  SystemConfig  $record
     */
    protected function handleRecordUpdate(Model $record, array $data): Model
    {
        $old = (string) $record->value;
        $new = (string) ($data['value'] ?? '');

        if ($new === $old) {
            return $record;
        }

        $record->forceFill([
            'value' => $new,
            'updated_by' => auth('admin')->id(),
            'updated_at' => now(),
        ])->save();

        AdminActivity::log('setting.changed', $record, [
            'key' => $record->key,
            'old' => $old,
            'new' => $new,
        ], "Changed setting {$record->key}");

        return $record;
    }
}
