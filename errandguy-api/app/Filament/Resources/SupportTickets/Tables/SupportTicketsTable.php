<?php

namespace App\Filament\Resources\SupportTickets\Tables;

use App\Filament\Resources\SupportTickets\Actions\SupportTicketActions;
use App\Filament\Support\DateRangeFilter;
use App\Filament\Support\ExportCsv;
use App\Models\SupportTicket;
use Filament\Actions\ViewAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class SupportTicketsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('last_message_at', 'desc')
            ->columns([
                TextColumn::make('subject')
                    ->searchable()
                    ->limit(40),
                TextColumn::make('user.full_name')
                    ->searchable(),
                TextColumn::make('category')
                    ->toggleable(),
                TextColumn::make('status')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'resolved' => 'success',
                        'open' => 'warning',
                        'pending' => 'info',
                        'closed' => 'gray',
                        default => 'gray',
                    }),
                // Who spoke LAST — the fact that decides whether this ticket is
                // waiting on us or on the user, and which the status column
                // cannot express (a customer reply leaves the ticket 'pending').
                // Both entries come from the latestMessage eager load in
                // SupportTicketResource::getEloquentQuery(), so the whole page
                // costs one extra query.
                TextColumn::make('latestMessage.sender_type')
                    ->label('Last from')
                    ->badge()
                    ->formatStateUsing(fn (?string $state): string => match ($state) {
                        'user' => 'Customer',
                        'agent' => 'Support',
                        'system' => 'System',
                        default => '—',
                    })
                    ->color(fn (?string $state): string => $state === 'user' ? 'warning' : 'gray')
                    ->tooltip(fn (?string $state): ?string => $state === 'user'
                        ? 'The user spoke last — this ticket is waiting on us.'
                        : null)
                    ->placeholder('—'),
                TextColumn::make('latestMessage.content')
                    ->label('Last message')
                    ->limit(60)
                    ->wrap()
                    ->placeholder('—')
                    ->toggleable(),
                TextColumn::make('last_message_at')
                    ->dateTime()
                    ->since()
                    ->sortable(),
                TextColumn::make('created_at')
                    ->since()
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                SelectFilter::make('status')
                    ->options([
                        'open' => 'Open',
                        'pending' => 'Pending',
                        'resolved' => 'Resolved',
                        'closed' => 'Closed',
                    ]),
                DateRangeFilter::make('created_at', 'Created'),
            ])
            ->headerActions([
                ExportCsv::make('support-tickets', [
                    'Subject' => fn (SupportTicket $r): ?string => $r->subject,
                    'User' => fn (SupportTicket $r): ?string => $r->user?->full_name,
                    'Category' => fn (SupportTicket $r): ?string => $r->category,
                    'Status' => fn (SupportTicket $r): ?string => $r->status,
                    'Last message' => fn (SupportTicket $r) => $r->last_message_at,
                    'Created' => fn (SupportTicket $r) => $r->created_at,
                ]),
            ])
            ->toolbarActions([
                ExportCsv::bulk('support-tickets', [
                    'Subject' => fn (SupportTicket $r): ?string => $r->subject,
                    'User' => fn (SupportTicket $r): ?string => $r->user?->full_name,
                    'Category' => fn (SupportTicket $r): ?string => $r->category,
                    'Status' => fn (SupportTicket $r): ?string => $r->status,
                    'Last message' => fn (SupportTicket $r) => $r->last_message_at,
                    'Created' => fn (SupportTicket $r) => $r->created_at,
                ]),
            ])
            ->recordActions([
                ViewAction::make(),
                ...SupportTicketActions::all(),
            ]);
    }
}
