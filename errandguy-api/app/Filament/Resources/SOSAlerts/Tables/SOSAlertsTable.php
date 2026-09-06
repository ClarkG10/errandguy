<?php

namespace App\Filament\Resources\SOSAlerts\Tables;

use App\Filament\Support\AdminNotify;
use App\Filament\Support\ExportCsv;
use App\Models\SOSAlert;
use Filament\Actions\Action;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\Textarea;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class SOSAlertsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('created_at')
                    ->label('Triggered')
                    ->dateTime()
                    ->sortable(),
                TextColumn::make('customer.full_name')
                    ->searchable(),
                TextColumn::make('runner.full_name')
                    ->label('Runner'),
                TextColumn::make('triggered_by_role')
                    ->badge(),
                TextColumn::make('booking.booking_number')
                    ->label('Booking')
                    ->toggleable(),
                TextColumn::make('status')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'active' => 'danger',
                        'resolved' => 'success',
                        default => 'gray',
                    }),
                TextColumn::make('resolved_at')
                    ->dateTime()
                    ->toggleable(),
            ])
            ->filters([
                SelectFilter::make('status')
                    ->options([
                        'active' => 'Active',
                        'resolved' => 'Resolved',
                    ])
                    ->default('active'),
            ])
            ->headerActions([
                ExportCsv::make('sos-alerts', [
                    'Booking' => fn (SOSAlert $r): ?string => $r->booking?->booking_number,
                    'Customer' => fn (SOSAlert $r): ?string => $r->customer?->full_name,
                    'Runner' => fn (SOSAlert $r): ?string => $r->runner?->full_name,
                    'Status' => fn (SOSAlert $r): ?string => $r->status,
                    'Triggered' => fn (SOSAlert $r) => $r->triggered_at,
                    'Resolved' => fn (SOSAlert $r) => $r->resolved_at,
                    'Contacts auto-notified' => fn (SOSAlert $r): bool => ! empty($r->contacts_notified),
                ]),
            ])
            ->recordActions([
                ViewAction::make(),
                Action::make('resolve')
                    ->label('Resolve')
                    ->icon(Heroicon::OutlinedShieldCheck)
                    ->color('success')
                    ->visible(fn ($record): bool => $record->status === 'active'
                        && (auth('admin')->user()?->canHandleSupport() ?? false))
                    ->schema([
                        Textarea::make('note')
                            ->label('Resolution note')
                            ->maxLength(1000),
                    ])
                    ->action(function (array $data, $record): void {
                        try {
                            app(\App\Services\SOSService::class)->deactivateSOS($record->booking_id);

                            if (! empty($data['note'])) {
                                $record->refresh();
                                $record->update(['resolution_note' => $data['note']]);
                            }

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
            ]);
    }
}
