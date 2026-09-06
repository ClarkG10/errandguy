<?php

namespace App\Filament\Resources\DisputeTickets\Tables;

use App\Filament\Resources\Bookings\BookingResource;
use App\Filament\Resources\DisputeTickets\Actions\DisputeTicketActions;
use App\Filament\Support\DateRangeFilter;
use App\Filament\Support\ExportCsv;
use App\Models\DisputeTicket;
use Filament\Actions\ViewAction;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

/**
 * The dispute queue.
 *
 * The decisions themselves live in {@see DisputeTicketActions} so the record
 * page's header carries the identical buttons — including the identical role
 * gates. (The admin REST twin of these actions has been removed — the Filament
 * action is now the single implementation, and carries the row-locked
 * preconditions that twin used to hold.)
 */
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
                    // One hop to the evidence: the booking number was plain text,
                    // so checking what actually happened meant a global search.
                    ->url(fn (DisputeTicket $record): ?string => $record->booking_id
                        ? BookingResource::getUrl('view', ['record' => $record->booking_id])
                        : null)
                    ->color(fn (DisputeTicket $record): ?string => $record->booking_id ? 'primary' : null)
                    ->toggleable(),
                // --- The facts the refund decision needs, on the row ---
                // Amount + how it was paid answer "is this a real refund case?"
                // before the admin opens anything. Both come from the eager loads
                // in DisputeTicketResource::getEloquentQuery(), never a per-row
                // query.
                TextColumn::make('booking.total_amount')
                    ->label('Amount')
                    ->money('PHP')
                    ->placeholder('—'),
                TextColumn::make('completedPayment.method')
                    ->label('Paid via')
                    ->badge()
                    ->color('gray')
                    ->formatStateUsing(fn (?string $state): ?string => $state ? strtoupper($state) : null)
                    ->placeholder('Unpaid'),
                IconColumn::make('is_refundable')
                    ->label('Refundable')
                    ->boolean()
                    ->tooltip(fn ($state): string => $state
                        ? 'A completed online payment exists — “Resolve + refund” can return it to the wallet.'
                        : 'No completed online payment (cash, unpaid or already refunded) — nothing for the platform to return.'),
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
                ...DisputeTicketActions::all(),
            ]);
    }
}
