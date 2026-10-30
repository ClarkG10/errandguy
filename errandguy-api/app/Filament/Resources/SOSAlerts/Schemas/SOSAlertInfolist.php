<?php

namespace App\Filament\Resources\SOSAlerts\Schemas;

use App\Models\SOSAlert;
use App\Models\TrustedContact;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;

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
                            ->formatStateUsing(fn (string $state): string => match ($state) {
                                'cancelled' => 'Cancelled by them',
                                default => ucfirst($state),
                            })
                            ->color(fn (string $state): string => match ($state) {
                                'active' => 'danger',
                                'resolved' => 'success',
                                default => 'gray',
                            }),
                        TextEntry::make('triggeredBy.full_name')
                            ->label('Raised by')
                            ->placeholder('—')
                            ->suffix(fn (SOSAlert $record): string => $record->triggered_by_role ? ' ('.$record->triggered_by_role.')' : ''),
                        // Click-to-call the person who pressed SOS.
                        TextEntry::make('triggeredBy.phone')
                            ->label('Their phone')
                            ->placeholder('—')
                            ->icon(Heroicon::OutlinedPhone)
                            ->url(fn (SOSAlert $record): ?string => filled($record->triggeredBy?->phone)
                                ? 'tel:'.$record->triggeredBy->phone
                                : null),
                        TextEntry::make('created_at')->label('Triggered')->dateTime(),
                        TextEntry::make('resolved_at')->label('Closed')->dateTime()->placeholder('—'),
                        TextEntry::make('closed_by')
                            ->label('Closed by')
                            ->placeholder('—')
                            ->state(fn (SOSAlert $record): ?string => $record->closedByLabel()),
                        TextEntry::make('resolution_note')->placeholder('—')->columnSpanFull(),
                    ]),
                // Where the person who pressed SOS is — their phone's own GPS
                // when it sent one, with where the fix came from spelled out so
                // a fallback is never mistaken for a live position.
                Section::make('Where they are')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('trigger_location')
                            ->label('Location when they pressed SOS')
                            ->placeholder('No location — call them and ask where they are.')
                            ->icon(Heroicon::OutlinedMapPin)
                            ->state(fn (SOSAlert $record): ?string => $record->triggerMapUrl() !== null
                                ? 'Open in Google Maps'
                                : null)
                            ->url(fn (SOSAlert $record): ?string => $record->triggerMapUrl())
                            ->openUrlInNewTab(),
                        TextEntry::make('trigger_location_source')
                            ->label('Source')
                            ->state(fn (SOSAlert $record): ?string => $record->trigger_lat !== null
                                ? $record->triggerLocationLabel()
                                : null)
                            ->placeholder('—'),
                        TextEntry::make('trigger_lat')->label('Latitude')->placeholder('—'),
                        TextEntry::make('trigger_lng')->label('Longitude')->placeholder('—'),
                        // Public trip-tracking endpoint (GET /api/v1/trip/{token}):
                        // the LIVE position, fresher than the snapshot above.
                        TextEntry::make('live_link_token')
                            ->label('Live location feed (JSON)')
                            ->placeholder('—')
                            ->state(fn (SOSAlert $record): ?string => filled($record->live_link_token) ? 'Open live feed' : null)
                            ->url(fn (SOSAlert $record): ?string => filled($record->live_link_token)
                                ? rtrim((string) config('app.url'), '/').'/api/v1/trip/'.$record->live_link_token
                                : null)
                            ->openUrlInNewTab(),
                        TextEntry::make('live_link_expires_at')->label('Live feed works until')->dateTime()->placeholder('—'),
                        TextEntry::make('runner_location')
                            ->label('Runner’s last ping when it was raised')
                            ->placeholder('No location')
                            ->icon(Heroicon::OutlinedMapPin)
                            ->state(fn (SOSAlert $record): ?string => ($record->runner_lat !== null && $record->runner_lng !== null)
                                ? 'Open in Google Maps'
                                : null)
                            ->url(fn (SOSAlert $record): ?string => ($record->runner_lat !== null && $record->runner_lng !== null)
                                ? 'https://www.google.com/maps?q='.$record->runner_lat.','.$record->runner_lng
                                : null)
                            ->openUrlInNewTab(),
                        TextEntry::make('dropoff_location')
                            ->label('Errand drop-off point')
                            ->placeholder('No location')
                            ->icon(Heroicon::OutlinedMapPin)
                            ->state(fn (SOSAlert $record): ?string => ($record->customer_lat !== null && $record->customer_lng !== null)
                                ? 'Open in Google Maps'
                                : null)
                            ->url(fn (SOSAlert $record): ?string => ($record->customer_lat !== null && $record->customer_lng !== null)
                                ? 'https://www.google.com/maps?q='.$record->customer_lat.','.$record->customer_lng
                                : null)
                            ->openUrlInNewTab(),
                    ]),
                Section::make('Participants')
                    ->description('The other person on the errand is NOT told about this alert. Decide whether to involve them.')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('customer.full_name')->label('Customer')->placeholder('—'),
                        // Click-to-call — tel: link on the customer's phone.
                        TextEntry::make('customer.phone')
                            ->label('Customer phone')
                            ->placeholder('—')
                            ->icon(Heroicon::OutlinedPhone)
                            ->url(fn (SOSAlert $record): ?string => filled($record->customer?->phone)
                                ? 'tel:'.$record->customer->phone
                                : null),
                        TextEntry::make('runner.full_name')->label('Runner')->placeholder('—'),
                        TextEntry::make('runner.phone')
                            ->label('Runner phone')
                            ->placeholder('—')
                            ->icon(Heroicon::OutlinedPhone)
                            ->url(fn (SOSAlert $record): ?string => filled($record->runner?->phone)
                                ? 'tel:'.$record->runner->phone
                                : null),
                        TextEntry::make('booking.booking_number')->label('Booking')->placeholder('—'),
                    ]),
                // Two DIFFERENT facts, deliberately not merged into one list:
                // who the platform actually texted (`contacts_notified` is
                // delivery-confirmed: only contacts the SMS provider accepted),
                // and who the operator may still need to call by hand.
                Section::make('Emergency contacts')
                    ->schema([
                        TextEntry::make('contacts_notified')
                            ->label('Texted by ErrandGuy')
                            ->listWithLineBreaks()
                            ->placeholder('None — no contact was texted (SMS not set up, it failed, or they have no contacts). Call them yourself using the list below.')
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
            ]);
    }
}
