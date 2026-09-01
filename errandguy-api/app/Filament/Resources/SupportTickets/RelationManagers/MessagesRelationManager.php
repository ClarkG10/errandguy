<?php

namespace App\Filament\Resources\SupportTickets\RelationManagers;

use App\Filament\Resources\SupportTickets\SupportTicketNotifier;
use App\Filament\Support\AdminNotify;
use App\Models\AdminUser;
use App\Support\AdminCache;
use Filament\Actions\Action;
use Filament\Forms\Components\Textarea;
use Filament\Resources\RelationManagers\RelationManager;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class MessagesRelationManager extends RelationManager
{
    protected static string $relationship = 'messages';

    protected static ?string $recordTitleAttribute = 'content';

    /** Per-request memo of the admin id => name map (see agentNames()). */
    private ?array $agentNames = null;

    public function table(Table $table): Table
    {
        return $table
            ->defaultSort('created_at')
            ->columns([
                // Was a bare 'agent' badge on every reply, so a handover could
                // not tell WHICH agent had already answered. Now it names them.
                TextColumn::make('sender_type')
                    ->label('From')
                    ->badge()
                    ->color(fn (?string $state): string => match ($state) {
                        'agent' => 'success',
                        'user' => 'warning',
                        default => 'gray',
                    })
                    ->formatStateUsing(fn (?string $state, $record): string => $this->senderLabel($state, $record))
                    ->tooltip(fn (?string $state): string => match ($state) {
                        'agent' => 'Support agent',
                        'user' => 'Ticket owner',
                        default => 'System',
                    }),
                TextColumn::make('content')->wrap(),
                TextColumn::make('created_at')->dateTime(),
            ])
            ->headerActions([
                Action::make('reply')
                    ->label('Reply')
                    ->schema([
                        Textarea::make('content')->required()->maxLength(2000),
                    ])
                    ->action(function (array $data): void {
                        $ticket = $this->getOwnerRecord();
                        $message = \App\Models\SupportMessage::create([
                            'ticket_id' => $ticket->id,
                            'sender_id' => auth('admin')->id(),
                            'sender_type' => 'agent',
                            'content' => $data['content'],
                        ]);
                        $ticket->update(['last_message_at' => now(), 'status' => 'pending']);

                        // Tell the OWNER something arrived. Without this the reply
                        // was invisible until the user happened to re-open the
                        // thread — in-app row + Reverb broadcast + device push,
                        // deliberately generic copy. Best-effort + latched, so it
                        // can neither fail nor double-send this reply.
                        SupportTicketNotifier::replied($ticket, $message);

                        AdminNotify::success('Reply sent', $ticket, ['Ticket' => $ticket->id], audit: 'support.replied');
                    }),
            ])
            ->recordActions([]);
    }

    /** Who wrote this message, by name. */
    private function senderLabel(?string $type, $record): string
    {
        return match ($type) {
            'agent' => $this->agentNames()[$record->sender_id] ?? 'Support agent',
            'user' => $this->getOwnerRecord()->user?->full_name ?? 'Customer',
            'system' => 'System',
            default => ucfirst((string) $type),
        };
    }

    /**
     * admin id => full name.
     *
     * An agent reply stores the ADMIN_USERS id in sender_id, while
     * SupportMessage::sender() points at users — so there is no relation to
     * eager-load here. admin_users is a handful of rows, so one cached map
     * (memoised per request, 60s+ in the admin cache) resolves the whole thread
     * without a query per message.
     *
     * @return array<string, string>
     */
    private function agentNames(): array
    {
        return $this->agentNames ??= AdminCache::rememberFor(
            'admin:support:agent-names',
            300,
            fn (): array => AdminUser::query()->pluck('full_name', 'id')->all(),
        );
    }
}
