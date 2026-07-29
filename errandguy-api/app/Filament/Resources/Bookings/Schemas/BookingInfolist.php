<?php

namespace App\Filament\Resources\Bookings\Schemas;

use App\Models\Booking;
use Filament\Infolists\Components\RepeatableEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Infolists\Components\ViewEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Components\Tabs;
use Filament\Schemas\Components\Tabs\Tab;
use Filament\Schemas\Schema;
use Filament\Support\Enums\TextSize;

class BookingInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                // ---- Hero summary: the at-a-glance answer to "what is this?" ----
                Section::make()
                    ->columns(4)
                    ->schema([
                        TextEntry::make('booking_number')
                            ->label('Booking')
                            ->weight('bold')
                            ->size(TextSize::Large)
                            ->copyable(),
                        TextEntry::make('status')
                            ->badge()
                            ->color(fn (string $state): string => self::statusColor($state)),
                        TextEntry::make('payment_status')
                            ->label('Payment')
                            ->badge()
                            ->color(fn (string $state): string => match ($state) {
                                'paid' => 'success',
                                'failed', 'expired' => 'danger',
                                'refunded' => 'info',
                                default => 'warning',
                            }),
                        TextEntry::make('total_amount')
                            ->money('PHP')
                            ->weight('bold')
                            ->color('success'),
                        TextEntry::make('customer.full_name')->label('Customer')->icon('heroicon-m-user'),
                        TextEntry::make('runner.full_name')->label('Runner')->placeholder('Unassigned')->icon('heroicon-m-truck'),
                        TextEntry::make('errandType.name')->label('Errand type')->placeholder('—')->badge()->color('gray'),
                        TextEntry::make('created_at')->label('Placed')->since()->dateTimeTooltip(),
                    ]),

                Tabs::make()
                    ->columnSpanFull()
                    ->persistTabInQueryString()
                    ->tabs([
                        // ---- Pricing breakdown ----
                        Tab::make('Pricing')
                            ->icon('heroicon-m-calculator')
                            ->schema([
                                Section::make('Fee breakdown')
                                    ->columns(3)
                                    ->schema([
                                        TextEntry::make('payment_method')->badge()->color('gray'),
                                        TextEntry::make('pricing_mode')->badge()->color('gray'),
                                        TextEntry::make('schedule_type')->badge()->color('gray'),
                                        TextEntry::make('base_fee')->money('PHP'),
                                        TextEntry::make('distance_fee')->money('PHP'),
                                        TextEntry::make('service_fee')->money('PHP'),
                                        TextEntry::make('surcharge')->money('PHP'),
                                        TextEntry::make('promo_discount')->money('PHP')->color('info'),
                                        TextEntry::make('cancellation_fee')->money('PHP')->color('danger'),
                                        TextEntry::make('runner_payout')->money('PHP')->color('warning'),
                                        TextEntry::make('distance_km')->label('Distance')->suffix(' km')->numeric(2)->placeholder('—'),
                                        TextEntry::make('total_amount')->money('PHP')->weight('bold')->color('success'),
                                    ]),
                            ]),

                        // ---- Route + embedded maps ----
                        Tab::make('Route')
                            ->icon('heroicon-m-map-pin')
                            ->schema([
                                Section::make('Addresses')
                                    ->columns(2)
                                    ->schema([
                                        TextEntry::make('pickup_address')->columnSpanFull()->icon('heroicon-m-arrow-up-circle')->iconColor('primary'),
                                        TextEntry::make('pickup_contact_name')->label('Pickup contact')->placeholder('—'),
                                        TextEntry::make('pickup_contact_phone')->label('Pickup phone')->placeholder('—')->copyable(),
                                        TextEntry::make('dropoff_address')->columnSpanFull()->icon('heroicon-m-arrow-down-circle')->iconColor('warning'),
                                        TextEntry::make('dropoff_contact_name')->label('Drop-off contact')->placeholder('—'),
                                        TextEntry::make('dropoff_contact_phone')->label('Drop-off phone')->placeholder('—')->copyable(),
                                        TextEntry::make('description')->placeholder('—')->columnSpanFull(),
                                        TextEntry::make('special_instructions')->placeholder('—')->columnSpanFull(),
                                    ]),
                                Section::make('Map')
                                    ->schema([
                                        ViewEntry::make('route_map')->hiddenLabel()->view('filament.entries.route-map'),
                                    ]),
                            ]),

                        // ---- Proof photos (click to enlarge) ----
                        Tab::make('Photos')
                            ->icon('heroicon-m-photo')
                            ->schema([
                                ViewEntry::make('photos')
                                    ->hiddenLabel()
                                    ->view('filament.entries.image-gallery', fn (Booking $record): array => [
                                        'images' => self::bookingPhotos($record),
                                    ]),
                            ]),

                        // ---- Visual status timeline ----
                        Tab::make('Timeline')
                            ->icon('heroicon-m-clock')
                            ->schema([
                                ViewEntry::make('timeline')
                                    ->hiddenLabel()
                                    ->view('filament.entries.timeline', fn (Booking $record): array => [
                                        'events' => self::bookingTimeline($record),
                                    ]),
                            ]),

                        // ---- Customer ↔ runner chat ----
                        Tab::make('Chat')
                            ->icon('heroicon-m-chat-bubble-left-right')
                            ->schema([
                                RepeatableEntry::make('messages')
                                    ->hiddenLabel()
                                    ->placeholder('No messages for this booking.')
                                    ->columns(3)
                                    ->schema([
                                        TextEntry::make('sender.full_name')->label('From')->placeholder('System'),
                                        TextEntry::make('content')->placeholder('—')->columnSpan(2),
                                        TextEntry::make('created_at')->dateTime()->columnSpanFull()->color('gray'),
                                    ]),
                            ]),
                    ]),
            ]);
    }

    private static function statusColor(string $state): string
    {
        return match ($state) {
            'completed', 'delivered' => 'success',
            'cancelled', 'no_runner' => 'danger',
            default => 'warning',
        };
    }

    /** Collect every photo attached to a booking as labelled gallery items. */
    private static function bookingPhotos(Booking $record): array
    {
        $images = [];

        foreach ((array) ($record->item_photos ?? []) as $i => $url) {
            $images[] = ['label' => 'Item photo '.($i + 1), 'url' => $url];
        }

        foreach ([
            'pickup_photo_url' => 'Pickup',
            'delivery_photo_url' => 'Delivery',
            'receipt_photo_url' => 'Receipt',
            'signature_url' => 'Signature',
        ] as $field => $label) {
            if (filled($record->{$field})) {
                $images[] = ['label' => $label, 'url' => $record->{$field}];
            }
        }

        return $images;
    }

    /** Build timeline events: prefer the status log, fall back to timestamps. */
    private static function bookingTimeline(Booking $record): array
    {
        $labels = [
            'pending' => 'Placed', 'matched' => 'Matched', 'accepted' => 'Accepted',
            'heading_to_pickup' => 'Heading to pickup', 'arrived_at_pickup' => 'Arrived at pickup',
            'picked_up' => 'Picked up', 'in_transit' => 'In transit', 'arrived_at_dropoff' => 'Arrived at drop-off',
            'delivered' => 'Delivered', 'completed' => 'Completed', 'cancelled' => 'Cancelled', 'no_runner' => 'No runner found',
        ];
        $color = fn (string $s): string => match ($s) {
            'completed', 'delivered' => '#10b981',
            'cancelled', 'no_runner' => '#f43f5e',
            default => '#2563eb',
        };

        $logs = $record->statusLogs()->orderBy('created_at')->get();
        if ($logs->isNotEmpty()) {
            return $logs->map(fn ($l): array => [
                'label' => $labels[$l->status] ?? ucfirst(str_replace('_', ' ', (string) $l->status)),
                'time' => $l->created_at,
                'note' => $l->note,
                'color' => $color((string) $l->status),
            ])->all();
        }

        // Fallback: synthesise from the milestone timestamp columns.
        $events = [];
        foreach ([
            'created_at' => 'pending', 'matched_at' => 'matched', 'accepted_at' => 'accepted',
            'picked_up_at' => 'picked_up', 'completed_at' => 'completed', 'cancelled_at' => 'cancelled',
        ] as $field => $status) {
            if (filled($record->{$field})) {
                $events[] = [
                    'label' => $labels[$status] ?? $status,
                    'time' => $record->{$field},
                    'note' => $status === 'cancelled' ? $record->cancellation_reason : null,
                    'color' => $color($status),
                ];
            }
        }

        return $events;
    }
}
