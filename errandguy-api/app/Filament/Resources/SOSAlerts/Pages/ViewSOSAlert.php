<?php

namespace App\Filament\Resources\SOSAlerts\Pages;

use App\Filament\Resources\SOSAlerts\SOSAlertResource;
use App\Filament\Support\AdminNotify;
use App\Services\SOSService;
use Filament\Actions\Action;
use Filament\Forms\Components\Textarea;
use Filament\Resources\Pages\ViewRecord;
use Filament\Support\Icons\Heroicon;

class ViewSOSAlert extends ViewRecord
{
    protected static string $resource = SOSAlertResource::class;

    protected function getHeaderActions(): array
    {
        return [
            Action::make('resolve')
                ->label('Mark resolved')
                ->icon(Heroicon::OutlinedShieldCheck)
                ->color('success')
                ->requiresConfirmation()
                ->modalDescription('Closes this alert and tells the person who raised it by push.')
                ->visible(fn (): bool => $this->getRecord()->status === 'active'
                    && (auth('admin')->user()?->canHandleSupport() ?? false))
                ->schema([
                    Textarea::make('note')
                        ->label('Resolution note')
                        ->maxLength(1000),
                ])
                ->action(function (array $data): void {
                    $record = $this->getRecord();

                    try {
                        $resolved = app(SOSService::class)
                            ->resolveByStaff($record, auth('admin')->id(), $data['note'] ?? null);

                        $record->refresh();

                        if (! $resolved) {
                            AdminNotify::warning('This SOS alert was already closed');

                            return;
                        }

                        AdminNotify::success(
                            'SOS alert resolved',
                            $record,
                            context: ['Booking' => $record->booking?->booking_number],
                            audit: 'sos.resolved',
                            properties: ['note' => $data['note'] ?? null],
                            note: 'The person who raised it has been told.',
                        );
                    } catch (\Throwable $e) {
                        AdminNotify::error('Could not resolve SOS alert', $e, $record);
                    }
                }),
        ];
    }
}
