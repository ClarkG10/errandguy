<?php

namespace App\Filament\Resources\DisputeTickets\Schemas;

use App\Models\DisputeTicket;
use Filament\Infolists\Components\TextEntry;
use Filament\Infolists\Components\ViewEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Enums\TextSize;

class DisputeTicketInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                // ---- Dispute hero ----
                Section::make()
                    ->columns(4)
                    ->schema([
                        TextEntry::make('category')
                            ->label('Category')
                            ->weight('bold')
                            ->size(TextSize::Large)
                            ->placeholder('Dispute')
                            ->columnSpan(2),
                        TextEntry::make('status')
                            ->badge()
                            ->color(fn (string $state): string => match ($state) {
                                'resolved' => 'success',
                                'open', 'reviewing' => 'warning',
                                'escalated' => 'danger',
                                default => 'gray',
                            }),
                        TextEntry::make('created_at')->label('Opened')->since()->dateTimeTooltip(),
                        TextEntry::make('reporter.full_name')->label('Reporter')->icon('heroicon-m-user')->placeholder('—'),
                        TextEntry::make('booking.booking_number')->label('Booking')->placeholder('—'),
                        TextEntry::make('description')->columnSpanFull()->placeholder('—'),
                    ]),

                // ---- Evidence (click to enlarge) ----
                Section::make('Evidence')
                    ->schema([
                        ViewEntry::make('evidence_gallery')
                            ->hiddenLabel()
                            ->view('filament.entries.image-gallery', fn (DisputeTicket $record): array => [
                                'images' => collect((array) ($record->evidence_urls ?? []))
                                    ->map(fn ($url, $i): array => ['label' => 'Evidence '.((int) $i + 1), 'url' => $url])
                                    ->values()
                                    ->all(),
                            ]),
                    ]),

                // ---- Resolution ----
                Section::make('Resolution')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('resolution')->columnSpanFull()->placeholder('Not yet resolved'),
                        TextEntry::make('resolved_by')->placeholder('—'),
                        TextEntry::make('resolved_at')->dateTime()->placeholder('—'),
                    ]),
            ]);
    }
}
