<?php

namespace App\Filament\Resources\DisputeTickets\Tables;

use App\Filament\Support\AdminNotify;
use App\Filament\Support\DateRangeFilter;
use App\Filament\Support\ExportCsv;
use App\Models\DisputeTicket;
use Filament\Actions\Action;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\Textarea;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class DisputeTicketsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('created_at')
                    ->dateTime()
                    ->since()
                    ->sortable(),
                TextColumn::make('reporter.full_name')
                    ->label('Reporter')
                    ->searchable(),
                TextColumn::make('category'),
                TextColumn::make('booking.booking_number')
                    ->label('Booking')
                    ->toggleable(),
                TextColumn::make('status')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'resolved' => 'success',
                        'open', 'reviewing' => 'warning',
                        'escalated' => 'danger',
                        default => 'gray',
                    }),
                TextColumn::make('resolved_at')
                    ->dateTime()
                    ->toggleable(),
            ])
            ->filters([
                SelectFilter::make('status')
                    ->options([
                        'open' => 'Open',
                        'reviewing' => 'Reviewing',
                        'resolved' => 'Resolved',
                        'escalated' => 'Escalated',
                    ]),
                DateRangeFilter::make('created_at', 'Created'),
            ])
            ->headerActions([
                ExportCsv::make('disputes', [
                    'Booking' => fn (DisputeTicket $r): ?string => $r->booking?->booking_number,
                    'Reporter' => fn (DisputeTicket $r): ?string => $r->reporter?->full_name,
                    'Category' => fn (DisputeTicket $r): ?string => $r->category,
                    'Status' => fn (DisputeTicket $r): ?string => $r->status,
                    'Created' => fn (DisputeTicket $r) => $r->created_at,
                    'Resolved' => fn (DisputeTicket $r) => $r->resolved_at,
                ]),
            ])
            ->toolbarActions([
                ExportCsv::bulk('disputes', [
                    'Booking' => fn (DisputeTicket $r): ?string => $r->booking?->booking_number,
                    'Reporter' => fn (DisputeTicket $r): ?string => $r->reporter?->full_name,
                    'Category' => fn (DisputeTicket $r): ?string => $r->category,
                    'Status' => fn (DisputeTicket $r): ?string => $r->status,
                    'Created' => fn (DisputeTicket $r) => $r->created_at,
                    'Resolved' => fn (DisputeTicket $r) => $r->resolved_at,
                ]),
            ])
            ->recordActions([
                ViewAction::make(),
                Action::make('resolve')
                    ->label('Resolve')
                    ->icon(Heroicon::OutlinedShieldCheck)
                    ->color('success')
                    ->visible(fn ($record): bool => ! in_array($record->status, ['resolved'], true)
                        && (auth('admin')->user()?->canHandleSupport() ?? false))
                    ->schema([
                        Textarea::make('resolution')
                            ->required()
                            ->maxLength(1000),
                    ])
                    ->action(function (array $data, $record): void {
                        $record->update([
                            'status' => 'resolved',
                            'resolution' => $data['resolution'],
                            'resolved_by' => auth('admin')->id(),
                            'resolved_at' => now(),
                        ]);
                        \App\Jobs\SendPushJob::dispatch($record->reported_by, 'Dispute Resolved', 'Your dispute has been resolved.');
                        AdminNotify::success('Dispute resolved', $record, [
                            'Ticket' => $record->id,
                            'Booking' => $record->booking?->booking_number,
                        ], audit: 'dispute.resolved');
                    }),
                Action::make('escalate')
                    ->label('Escalate')
                    ->icon(Heroicon::OutlinedExclamationTriangle)
                    ->color('danger')
                    ->requiresConfirmation()
                    ->visible(fn ($record): bool => $record->status !== 'escalated'
                        && (auth('admin')->user()?->canHandleSupport() ?? false))
                    ->action(function ($record): void {
                        $record->update(['status' => 'escalated']);
                        AdminNotify::success('Dispute escalated', $record, [
                            'Ticket' => $record->id,
                            'Booking' => $record->booking?->booking_number,
                        ], audit: 'dispute.escalated', note: 'It has been flagged for senior review.');
                    }),
            ]);
    }
}
