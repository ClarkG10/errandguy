<?php

namespace App\Filament\Resources\SupportTickets\Tables;

use App\Filament\Support\ExportCsv;
use App\Models\SupportTicket;
use App\Support\AdminActivity;
use Filament\Actions\Action;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\Select;
use Filament\Notifications\Notification;
use Filament\Support\Icons\Heroicon;
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
                TextColumn::make('last_message_at')
                    ->dateTime()
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
            ->recordActions([
                ViewAction::make(),
                Action::make('setStatus')
                    ->label('Set status')
                    ->icon(Heroicon::OutlinedChatBubbleLeftRight)
                    ->visible(fn (): bool => auth('admin')->user()?->canHandleSupport() ?? false)
                    ->schema([
                        Select::make('status')
                            ->required()
                            ->options([
                                'open' => 'Open',
                                'pending' => 'Pending',
                                'resolved' => 'Resolved',
                                'closed' => 'Closed',
                            ]),
                    ])
                    ->fillForm(fn ($record): array => ['status' => $record->status])
                    ->action(function (array $data, $record): void {
                        $record->update(['status' => $data['status']]);
                        AdminActivity::log('support.status_changed', $record, ['status' => $data['status']]);
                        Notification::make()->title('Status updated')->success()->send();
                    }),
            ]);
    }
}
