<?php

namespace App\Filament\Resources\SupportTickets\Actions;

use App\Filament\Resources\SupportTickets\SupportTicketNotifier;
use App\Filament\Support\AdminNotify;
use Filament\Actions\Action;
use Filament\Forms\Components\Select;
use Filament\Support\Icons\Heroicon;

/**
 * Support-ticket decisions, built once and mounted both on the list row and in
 * the record page's header — so an agent who has just read the whole thread can
 * close it from there instead of navigating back to the list and re-finding the
 * row.
 *
 * A table action is handed the row's record; a page header action falls back to
 * the page record (HasActions::getDefaultActionRecord). Both inject the same
 * `$record`, so the canHandleSupport gate is shared by construction.
 */
class SupportTicketActions
{
    /** @return array<int, Action> */
    public static function all(): array
    {
        return [
            self::setStatus(),
        ];
    }

    public static function setStatus(): Action
    {
        return Action::make('setStatus')
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
                $previous = $record->status;
                $record->update(['status' => $data['status']]);

                // Tell the owner their ticket moved (resolved/closed/
                // re-opened) — previously silent, so a user waiting on a
                // resolution never learned it landed. Only on a REAL
                // change; latched + best-effort inside the notifier.
                if ($data['status'] !== $previous) {
                    SupportTicketNotifier::statusChanged($record, $data['status']);
                }

                AdminNotify::success(
                    'Ticket status updated',
                    $record,
                    ['Ticket' => $record->id, 'New status' => $data['status'] ?? $record->status],
                    audit: 'support.status_changed',
                    properties: ['status' => $data['status']],
                );
            });
    }
}
