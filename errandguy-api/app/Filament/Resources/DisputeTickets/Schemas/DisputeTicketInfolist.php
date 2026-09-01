<?php

namespace App\Filament\Resources\DisputeTickets\Schemas;

use App\Filament\Resources\Bookings\BookingResource;
use App\Models\DisputeTicket;
use Filament\Infolists\Components\TextEntry;
use Filament\Infolists\Components\ViewEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Enums\TextSize;
use Illuminate\Support\Str;
use Spatie\Activitylog\Models\Activity;

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
                        TextEntry::make('booking.booking_number')
                            ->label('Booking')
                            // The evidence for most disputes is the booking
                            // itself; this was plain text, so getting there meant
                            // a global search on the number.
                            ->url(fn (DisputeTicket $record): ?string => $record->booking_id
                                ? BookingResource::getUrl('view', ['record' => $record->booking_id])
                                : null)
                            ->color(fn (DisputeTicket $record): ?string => $record->booking_id ? 'primary' : null)
                            ->placeholder('—'),
                        // Who has claimed the case. There is no claimant column,
                        // so the name comes from the audit entry the "Start
                        // reviewing" action writes — a single lookup on a
                        // single-record page, and only while it is being reviewed.
                        TextEntry::make('claimed_by')
                            ->label('Being reviewed by')
                            ->icon('heroicon-m-magnifying-glass')
                            ->visible(fn (DisputeTicket $record): bool => $record->status === 'reviewing')
                            ->state(fn (DisputeTicket $record): ?string => self::claimant($record))
                            ->placeholder('an admin (not recorded)'),
                        TextEntry::make('description')->columnSpanFull()->placeholder('—'),
                    ]),

                // ---- The refund decision's facts ----
                // "Resolve" vs "Resolve + refund" hinges on whether the booking
                // was paid online and for how much. That used to be invisible
                // here, so the choice was made blind and only failed after the
                // note had been typed.
                Section::make('Payment')
                    ->columns(3)
                    ->schema([
                        TextEntry::make('booking.total_amount')
                            ->label('Booking total')
                            ->money('PHP')
                            ->placeholder('—'),
                        TextEntry::make('completedPayment.method')
                            ->label('Paid via')
                            ->badge()
                            ->color('gray')
                            ->formatStateUsing(fn (?string $state): ?string => $state ? strtoupper($state) : null)
                            ->placeholder('No completed payment'),
                        TextEntry::make('refundable')
                            ->label('Refundable')
                            ->badge()
                            ->color(fn (DisputeTicket $record): string => self::isRefundable($record) ? 'success' : 'gray')
                            ->state(fn (DisputeTicket $record): string => self::refundableLabel($record)),
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
                        TextEntry::make('resolved_by')
                            ->label('Resolved by')
                            // resolved_by is an ADMIN_USERS id, so it rendered as
                            // a bare UUID an admin had to look up elsewhere. Keep
                            // a truncated id when the admin record is gone, so a
                            // historic row stays traceable.
                            ->state(fn (DisputeTicket $record): ?string => $record->resolvedBy?->full_name
                                ?? ($record->resolved_by ? 'admin '.Str::limit((string) $record->resolved_by, 8, '…') : null))
                            ->placeholder('—'),
                        TextEntry::make('resolved_at')->dateTime()->placeholder('—'),
                    ]),
            ]);
    }

    /** Is there a completed, non-cash payment behind this dispute? */
    private static function isRefundable(DisputeTicket $record): bool
    {
        $payment = $record->completedPayment;

        return $payment !== null && $payment->method !== 'cash';
    }

    /** Plain-language answer to "can I press Resolve + refund?". */
    private static function refundableLabel(DisputeTicket $record): string
    {
        $payment = $record->completedPayment;

        if ($payment === null) {
            return 'Nothing to refund — no completed payment';
        }

        if ($payment->method === 'cash') {
            return 'Cash — settled with the runner, nothing to refund';
        }

        return '₱'.number_format((float) $payment->amount, 2).' can go back to the wallet';
    }

    /**
     * The admin who claimed the dispute, from the audit entry written by
     * DisputeTicketActions::startReviewing(). Returns null (→ placeholder) for a
     * ticket that reached 'reviewing' some other way.
     */
    private static function claimant(DisputeTicket $record): ?string
    {
        $activity = Activity::query()
            ->where('log_name', 'admin')
            ->where('event', 'dispute.reviewing')
            ->where('subject_type', $record->getMorphClass())
            ->where('subject_id', $record->getKey())
            ->with('causer')
            ->latest('created_at')
            ->first();

        return $activity?->causer?->full_name;
    }
}
