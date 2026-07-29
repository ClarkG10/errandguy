<?php

namespace App\Filament\Resources\Payments\Schemas;

use App\Models\Payment;
use Filament\Infolists\Components\TextEntry;
use Filament\Infolists\Components\ViewEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Enums\TextSize;

class PaymentInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                // ---- Payment hero ----
                Section::make()
                    ->columns(4)
                    ->schema([
                        TextEntry::make('amount')
                            ->money('PHP')
                            ->weight('bold')
                            ->size(TextSize::Large),
                        TextEntry::make('status')
                            ->badge()
                            ->color(fn (string $state): string => match ($state) {
                                'completed' => 'success',
                                'pending', 'processing' => 'warning',
                                'failed', 'cancelled', 'expired' => 'danger',
                                'refunded' => 'info',
                                default => 'gray',
                            }),
                        TextEntry::make('method')->badge()->color('gray'),
                        TextEntry::make('booking.booking_number')->label('Booking')->placeholder('—'),
                        TextEntry::make('customer.full_name')->label('Customer')->icon('heroicon-m-user')->placeholder('—'),
                        TextEntry::make('created_at')->label('Created')->since()->dateTimeTooltip(),
                    ]),

                // ---- Settlement details ----
                Section::make('Settlement')
                    ->columns(3)
                    ->schema([
                        TextEntry::make('currency'),
                        TextEntry::make('gateway_tx_id')->label('Gateway Tx ID')->placeholder('—')->copyable(),
                        TextEntry::make('paid_at')->dateTime()->placeholder('—'),
                        TextEntry::make('refund_amount')->money('PHP')->placeholder('—')->color('info'),
                        TextEntry::make('refunded_at')->dateTime()->placeholder('—'),
                    ]),

                // ---- Immutable status trail ----
                Section::make('Status timeline')
                    ->description('Every status change, recorded by Payment::transitionTo (never edited directly).')
                    ->schema([
                        ViewEntry::make('transitions_timeline')
                            ->hiddenLabel()
                            ->view('filament.entries.timeline', fn (Payment $record): array => [
                                'events' => $record->transitions()->orderBy('created_at')->get()->map(fn ($t): array => [
                                    'label' => ($t->from_status ? ucfirst((string) $t->from_status).' → ' : '').ucfirst((string) $t->to_status),
                                    'time' => $t->created_at,
                                    'note' => trim(($t->actor ? 'by '.$t->actor : 'system').($t->reason ? ' · '.$t->reason : '')),
                                    'color' => match ((string) $t->to_status) {
                                        'completed' => '#10b981',
                                        'failed', 'cancelled', 'expired' => '#f43f5e',
                                        'refunded' => '#0ea5e9',
                                        default => '#2563eb',
                                    },
                                ])->all(),
                            ]),
                    ]),
            ]);
    }
}
