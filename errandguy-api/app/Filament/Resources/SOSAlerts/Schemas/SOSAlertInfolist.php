<?php

namespace App\Filament\Resources\SOSAlerts\Schemas;

use App\Models\SOSAlert;
use App\Models\TrustedContact;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class SOSAlertInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Alert')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('status')
                            ->badge()
                            ->color(fn (string $state): string => match ($state) {
                                'active' => 'danger',
                                'resolved' => 'success',
                                default => 'gray',
                            }),
                        TextEntry::make('triggered_by_role')->badge(),
                        TextEntry::make('created_at')->label('Triggered')->dateTime(),
                        TextEntry::make('resolved_at')->dateTime()->placeholder('—'),
                        TextEntry::make('resolution_note')->placeholder('—')->columnSpanFull(),
                    ]),
                Section::make('Participants')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('customer.full_name')->label('Customer')->placeholder('—'),
                        // Click-to-call — tel: link on the customer's phone.
                        TextEntry::make('customer.phone')
                            ->label('Customer phone')
                            ->placeholder('—')
                            ->icon(\Filament\Support\Icons\Heroicon::OutlinedPhone)
                            ->url(fn (SOSAlert $record): ?string => filled($record->customer?->phone)
                                ? 'tel:'.$record->customer->phone
                                : null),
                        TextEntry::make('runner.full_name')->label('Runner')->placeholder('—'),
                        TextEntry::make('runner.phone')
                            ->label('Runner phone')
                            ->placeholder('—')
                            ->icon(\Filament\Support\Icons\Heroicon::OutlinedPhone)
                            ->url(fn (SOSAlert $record): ?string => filled($record->runner?->phone)
                                ? 'tel:'.$record->runner->phone
                                : null),
                        TextEntry::make('booking.booking_number')->label('Booking')->placeholder('—'),
                    ]),
                // Two DIFFERENT facts, deliberately not merged into one list:
                // who the platform actually reached, and who the operator still
                // has to reach by hand. `contacts_notified` is delivery-confirmed
                // and, with no SMS provider wired, is always empty — so an
                // operator reading only that would conclude the person has no
                // emergency contacts, when in fact nobody has called them yet.
                Section::make('Emergency contacts')
                    ->schema([
                        TextEntry::make('contacts_notified')
                            ->label('Auto-notified by ErrandGuy')
                            ->listWithLineBreaks()
                            ->placeholder('None — no SMS provider is configured, so no contact was auto-notified. Call them yourself using the list below.')
                            ->state(function (SOSAlert $record): array {
                                $ids = $record->contacts_notified ?? [];
                                if (empty($ids)) {
                                    return [];
                                }

                                $contacts = TrustedContact::whereIn('id', $ids)
                                    ->orderBy('priority')
                                    ->get();

                                if ($contacts->isEmpty()) {
                                    return array_map(fn ($id): string => (string) $id, $ids);
                                }

                                return $contacts
                                    ->map(fn (TrustedContact $c): string => collect([
                                        $c->name,
                                        $c->relationship,
                                        $c->phone,
                                    ])->filter()->implode(' · '))
                                    ->all();
                            }),
                        // The people to ring RIGHT NOW, in the order the person
                        // chose (priority = who they want called first).
                        TextEntry::make('contacts_to_call')
                            ->label('Their trusted contacts — call in this order')
                            ->listWithLineBreaks()
                            ->placeholder('This person has no trusted contacts saved.')
                            ->state(fn (SOSAlert $record): array => TrustedContact::query()
                                ->where('user_id', $record->triggered_by)
                                ->orderBy('priority')
                                ->get()
                                ->map(fn (TrustedContact $c): string => collect([
                                    $c->name,
                                    $c->relationship,
                                    $c->phone,
                                ])->filter()->implode(' · '))
                                ->all()),
                    ]),
                Section::make('Live link & location')
                    ->columns(2)
                    ->schema([
                        // Public trip-tracking endpoint. Route: GET /api/v1/trip/{token}
                        // (routes/api.php — "Public trip tracking (no auth, rate
                        // limited)"). This returns the LIVE location JSON (fresher
                        // than the trigger-time snapshot in the Maps links below),
                        // so it's labelled as a raw feed, not a map page. Built from
                        // config('app.url'); opens in a new tab.
                        TextEntry::make('live_link_token')
                            ->label('Live location feed (JSON)')
                            ->placeholder('—')
                            ->url(fn (SOSAlert $record): ?string => filled($record->live_link_token)
                                ? rtrim((string) config('app.url'), '/').'/api/v1/trip/'.$record->live_link_token
                                : null)
                            ->openUrlInNewTab(),
                        TextEntry::make('live_link_expires_at')->dateTime()->placeholder('—'),
                        // Customer location → Google Maps.
                        TextEntry::make('customer_location')
                            ->label('Customer location')
                            ->placeholder('No location')
                            ->icon(\Filament\Support\Icons\Heroicon::OutlinedMapPin)
                            ->state(fn (SOSAlert $record): ?string => ($record->customer_lat !== null && $record->customer_lng !== null)
                                ? 'Open in Google Maps'
                                : null)
                            ->url(fn (SOSAlert $record): ?string => ($record->customer_lat !== null && $record->customer_lng !== null)
                                ? 'https://www.google.com/maps?q='.$record->customer_lat.','.$record->customer_lng
                                : null)
                            ->openUrlInNewTab(),
                        // Runner location → Google Maps.
                        TextEntry::make('runner_location')
                            ->label('Runner location')
                            ->placeholder('No location')
                            ->icon(\Filament\Support\Icons\Heroicon::OutlinedMapPin)
                            ->state(fn (SOSAlert $record): ?string => ($record->runner_lat !== null && $record->runner_lng !== null)
                                ? 'Open in Google Maps'
                                : null)
                            ->url(fn (SOSAlert $record): ?string => ($record->runner_lat !== null && $record->runner_lng !== null)
                                ? 'https://www.google.com/maps?q='.$record->runner_lat.','.$record->runner_lng
                                : null)
                            ->openUrlInNewTab(),
                        TextEntry::make('customer_lat')->label('Customer lat')->placeholder('—'),
                        TextEntry::make('customer_lng')->label('Customer lng')->placeholder('—'),
                        TextEntry::make('runner_lat')->label('Runner lat')->placeholder('—'),
                        TextEntry::make('runner_lng')->label('Runner lng')->placeholder('—'),
                    ]),
            ]);
    }
}
