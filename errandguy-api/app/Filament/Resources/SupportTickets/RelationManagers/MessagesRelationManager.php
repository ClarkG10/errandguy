<?php

namespace App\Filament\Resources\SupportTickets\RelationManagers;

use App\Filament\Resources\SupportTickets\SupportTicketNotifier;
use App\Filament\Support\AdminNotify;
use Filament\Actions\Action;
use Filament\Forms\Components\Textarea;
use Filament\Resources\RelationManagers\RelationManager;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class MessagesRelationManager extends RelationManager
{
    protected static string $relationship = 'messages';

    protected static ?string $recordTitleAttribute = 'content';

    public function table(Table $table): Table
    {
        return $table
            ->defaultSort('created_at')
            ->columns([
                TextColumn::make('sender_type')->badge(),
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
}
