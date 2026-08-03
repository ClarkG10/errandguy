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
                        // Prefer the service so the booking flag flips and the
                        // runner gets the "SOS resolved" broadcast. When the
                        // alert has no booking, resolve the alert directly.
                        if (filled($record->booking_id)) {
                            app(SOSService::class)->deactivateSOS($record->booking_id);

                            if (! empty($data['note'])) {
                                $record->refresh();
                                $record->update(['resolution_note' => $data['note']]);
                            }
                        } else {
                            $record->update([
                                'status' => 'resolved',
                                'resolved_at' => now(),
                                'resolution_note' => $data['note'] ?? null,
                            ]);
                        }

                        $record->refresh();

                        AdminNotify::success(
                            'SOS alert resolved',
                            $record,
                            context: ['Booking' => $record->booking?->booking_number],
                            audit: 'sos.resolved',
                            properties: ['note' => $data['note'] ?? null],
                        );
                    } catch (\Throwable $e) {
                        AdminNotify::error('Could not resolve SOS alert', $e, $record);
                    }
                }),
        ];
    }
}
