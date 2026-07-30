<?php

namespace App\Filament\Resources\SupportTickets\RelationManagers;

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
                        \App\Models\SupportMessage::create([
                            'ticket_id' => $ticket->id,
                            'sender_id' => auth('admin')->id(),
                            'sender_type' => 'agent',
                            'content' => $data['content'],
                        ]);
                        $ticket->update(['last_message_at' => now(), 'status' => 'pending']);
                        AdminNotify::success('Reply sent', $ticket, ['Ticket' => $ticket->id], audit: 'support.replied');
                    }),
            ])
            ->recordActions([]);
    }
}
