<?php

namespace App\Services;

use App\Jobs\NotifySosContactsJob;
use App\Models\AdminAlert;
use App\Models\Booking;
use App\Models\SOSAlert;
use App\Models\TrustedContact;
use App\Services\Sms\SmsSender;
use App\Support\AdminCache;
use App\Support\OpsAlertRecipients;
use App\Support\PhilippinePhone;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class SOSService
{
    /**
     * What the raiser's app is told about the alert they just raised.
     *
     * @return array<string, mixed>
     */
    public static function publicSummary(\App\Models\SOSAlert $alert): array
    {
        return [
            'id' => $alert->id,
            'booking_id' => $alert->booking_id,
            'status' => $alert->status,
            'triggered_by_role' => $alert->triggered_by_role,
            'triggered_at' => $alert->triggered_at,
            'contacts_notified' => $alert->contacts_notified,
            'live_link_expires_at' => $alert->live_link_expires_at,
        ];
    }

    /** How long the live-location link handed out with an SOS keeps working. */
    public const LIVE_LINK_MINUTES = 60;

    /** An alert still open this long after its errand ended is closed automatically. */
    public const STALE_AFTER_ERRAND_HOURS = 24;

    public function __construct(
        private NotificationService $notificationService,
    ) {}

    /**
     * Raise an SOS for a booking.
     *
     * One open alert per PERSON per booking: pressing again returns your own
     * open alert, while the other person on the errand pressing SOS raises
     * their own — staff need to know both pressed it, and each can only call
     * off their own (cancelByRaiser).
     *
     * @param  string  $triggeredBy  user-id of the person pulling the alarm
     * @param  string  $role         'customer' or 'runner'
     * @param  array{lat: float, lng: float, accuracy: ?float}|null  $deviceLocation
     *         the phone's own GPS fix sent with the alert (see deviceLocationFrom)
     */
    public function triggerSOS(string $bookingId, string $triggeredBy, string $role = 'customer', ?array $deviceLocation = null): SOSAlert
    {
        $created = false;

        // Serialize concurrent presses on the booking row so a double tap (or a
        // client retry racing the first request) re-reads and returns the same
        // alert instead of inserting a second one. On SQLite lockForUpdate is a
        // no-op (writes serialize globally); on MySQL it is a real row lock.
        $alert = DB::transaction(function () use ($bookingId, $triggeredBy, $role, $deviceLocation, &$created) {
            $booking = Booking::with(['runner.runnerProfile'])
                ->lockForUpdate()
                ->findOrFail($bookingId);

            $existing = SOSAlert::where('booking_id', $bookingId)
                ->where('triggered_by', $triggeredBy)
                ->where('status', SOSAlert::STATUS_ACTIVE)
                ->latest('triggered_at')
                ->first();
            if ($existing) {
                return $existing;
            }

            $runnerProfile = $booking->runner?->runnerProfile;
            $location = $this->triggerLocation($booking, $role, $deviceLocation);

            $alert = SOSAlert::create([
                'booking_id' => $bookingId,
                'customer_id' => $booking->customer_id,
                'runner_id' => $booking->runner_id,
                'triggered_by' => $triggeredBy,
                'triggered_by_role' => $role,
                'triggered_at' => now(),
                // The errand's drop-off point and the runner's last ping, kept
                // as before; where the person who pressed SOS actually is lives
                // in trigger_lat/lng.
                'customer_lat' => $booking->dropoff_lat,
                'customer_lng' => $booking->dropoff_lng,
                'runner_lat' => $runnerProfile?->current_lat,
                'runner_lng' => $runnerProfile?->current_lng,
                'trigger_lat' => $location['lat'],
                'trigger_lng' => $location['lng'],
                'trigger_accuracy_m' => $location['accuracy'],
                'trigger_location_source' => $location['source'],
                'live_link_token' => Str::random(64),
                'live_link_expires_at' => now()->addMinutes(self::LIVE_LINK_MINUTES),
                'contacts_notified' => [],
                'status' => SOSAlert::STATUS_ACTIVE,
            ]);

            // `contacts_notified` is DELIVERY-CONFIRMED, not intent: it starts
            // empty here and NotifySosContactsJob fills it only with the
            // contacts the SMS provider accepted a text for. The app tells the
            // person in the emergency who their alert reached from this field,
            // so never pre-fill it.

            $booking->update(['sos_triggered' => true]);

            $created = true;

            return $alert;
        });

        // Side-effects run AFTER commit and ONLY for a new alert (pressing
        // again must not re-alert): nothing best-effort can roll back the
        // safety record, and the fan-out never sees an uncommitted row.
        if ($created) {
            $alert->loadMissing(['booking', 'triggeredBy']);

            AdminAlert::raise(
                'sos',
                'critical',
                'SOS triggered',
                'Booking '.($alert->booking?->booking_number ?? $alert->booking_id).' — '
                    .($alert->triggeredBy?->full_name ?? 'the '.$role).' ('.$role.') pressed SOS.',
                $alert->id,
            );

            // The SOS badge and the dashboard queue card are cached for 60s;
            // show the new alert on the next render instead.
            AdminCache::flush();

            // Email + texts to staff and texts to trusted contacts, run in this
            // process right after the response is sent — the panic button
            // returns at once, and nothing waits on a queue worker that may be
            // down.
            NotifySosContactsJob::dispatchAfterResponse($alert->id);
        }

        return $alert;
    }

    /**
     * The person who raised an SOS calls it off. Closes ONLY their own open
     * alerts on this booking — never one the other person raised. Nobody else
     * is notified: the other person on the errand was never told about it.
     *
     * @return int how many alerts were closed (0 when they had none open)
     */
    public function cancelByRaiser(string $bookingId, string $userId, string $role): int
    {
        // Lock the booking row (as triggerSOS does) so a concurrent trigger
        // can't interleave and leave the flag and the alerts inconsistent.
        return DB::transaction(function () use ($bookingId, $userId, $role) {
            $booking = Booking::whereKey($bookingId)->lockForUpdate()->first();
            if (! $booking) {
                return 0;
            }

            $closed = SOSAlert::where('booking_id', $bookingId)
                ->where('triggered_by', $userId)
                ->where('status', SOSAlert::STATUS_ACTIVE)
                ->update([
                    'status' => SOSAlert::STATUS_CANCELLED,
                    'resolved_at' => now(),
                    'resolved_by' => $userId,
                    'resolved_by_type' => $role,
                ]);

            $this->syncBookingFlag($booking);

            if ($closed > 0) {
                AdminCache::flush();
            }

            return $closed;
        });
    }

    /**
     * Staff close an alert from the admin panel. The person who raised it is
     * told, by push, that the alert was closed.
     *
     * @return bool false when the alert was already closed
     */
    public function resolveByStaff(SOSAlert $alert, ?string $adminId, ?string $note = null): bool
    {
        $resolved = DB::transaction(function () use ($alert, $adminId, $note) {
            $booking = Booking::whereKey($alert->booking_id)->lockForUpdate()->first();

            $closed = SOSAlert::whereKey($alert->getKey())
                ->where('status', SOSAlert::STATUS_ACTIVE)
                ->update([
                    'status' => SOSAlert::STATUS_RESOLVED,
                    'resolved_at' => now(),
                    'resolved_by' => $adminId,
                    'resolved_by_type' => 'admin',
                    'resolution_note' => filled($note) ? $note : null,
                ]);

            if ($booking) {
                $this->syncBookingFlag($booking);
            }

            return $closed > 0;
        });

        if (! $resolved) {
            return false;
        }

        AdminCache::flush();

        // After commit, so the push never describes an uncommitted change.
        // Best-effort: a push outage must not undo or fail the resolve.
        if ($alert->triggered_by) {
            try {
                $this->notificationService->sendPush(
                    $alert->triggered_by,
                    'Your SOS alert was closed',
                    'ErrandGuy’s safety team closed your emergency alert. If you still need help, press SOS again or call 911.',
                    [
                        'type' => 'sos',
                        'booking_id' => $alert->booking_id,
                        'alert_id' => $alert->id,
                        'status' => SOSAlert::STATUS_RESOLVED,
                    ],
                );
            } catch (\Throwable $e) {
                Log::warning('SOS resolved, but the person who raised it could not be notified', [
                    'alert_id' => $alert->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return true;
    }

    /**
     * Close alerts still open STALE_AFTER_ERRAND_HOURS after their errand
     * ended (completed, cancelled or no runner found). Logged one by one.
     *
     * @return int how many were closed
     */
    public function closeStale(): int
    {
        $cutoff = now()->subHours(self::STALE_AFTER_ERRAND_HOURS);
        $closed = 0;

        $candidates = SOSAlert::query()
            ->where('status', SOSAlert::STATUS_ACTIVE)
            ->whereHas('booking', fn ($q) => $q
                ->whereIn('status', \App\Enums\BookingStatus::ENDED)
                ->whereRaw('COALESCE(bookings.completed_at, bookings.cancelled_at, bookings.updated_at) < ?', [$cutoff]))
            ->orderBy('triggered_at')
            ->limit(500)
            ->get(['id', 'booking_id', 'triggered_at']);

        foreach ($candidates as $candidate) {
            $done = DB::transaction(function () use ($candidate) {
                $booking = Booking::whereKey($candidate->booking_id)->lockForUpdate()->first();

                $updated = SOSAlert::whereKey($candidate->id)
                    ->where('status', SOSAlert::STATUS_ACTIVE)
                    ->update([
                        'status' => SOSAlert::STATUS_RESOLVED,
                        'resolved_at' => now(),
                        'resolved_by' => null,
                        'resolved_by_type' => 'system',
                        'resolution_note' => 'Closed automatically: still open '.self::STALE_AFTER_ERRAND_HOURS.' hours after the errand ended.',
                    ]);

                if ($booking) {
                    $this->syncBookingFlag($booking);
                }

                return $updated > 0;
            });

            if ($done) {
                Log::warning('Stale SOS alert closed automatically', [
                    'alert_id' => $candidate->id,
                    'booking_id' => $candidate->booking_id,
                    'triggered_at' => $candidate->triggered_at?->toIso8601String(),
                ]);
                $closed++;
            }
        }

        if ($closed > 0) {
            AdminCache::flush();
        }

        return $closed;
    }

    public function getActiveSOS(): \Illuminate\Database\Eloquent\Collection
    {
        return SOSAlert::where('status', SOSAlert::STATUS_ACTIVE)
            ->with(['booking', 'customer', 'runner'])
            ->orderByDesc('triggered_at')
            ->get();
    }

    /**
     * What the person who pressed SOS is told, in plain words, and the facts
     * behind it. Describes what is being done the moment the alert is saved:
     * the texts and emails go out right after the reply, so the reply says
     * "we're texting", never "we texted".
     *
     * @return array{message: string, alerted: array<string, mixed>}
     */
    public function alertSummary(SOSAlert $alert): array
    {
        $sms = app(SmsSender::class);
        $smsReady = $sms->isConfigured();

        $contacts = TrustedContact::where('user_id', $alert->triggered_by)
            ->where('is_active', true)
            ->pluck('phone');
        $textable = $contacts->filter(fn ($phone) => PhilippinePhone::normalize($phone) !== null)->count();
        // Trusted contacts get a few rounds of texts a day per person
        // (NotifySosContactsJob); past that, say so instead of promising texts.
        $roundsLeft = \App\Jobs\NotifySosContactsJob::canTextContactsAgainToday((string) $alert->triggered_by);
        $texting = $smsReady && $roundsLeft ? $textable : 0;

        $staffEmails = count(OpsAlertRecipients::emails());
        $staffPhones = $smsReady ? count(OpsAlertRecipients::phones()) : 0;

        $message = 'SOS sent to ErrandGuy’s safety team.';
        if ($contacts->isEmpty()) {
            $message .= ' You have no trusted contacts saved.';
        } elseif ($smsReady && $textable > 0 && ! $roundsLeft) {
            $message .= ' We’ve already texted your trusted contacts several times today, so we didn’t text them again — call them if you can.';
        } elseif ($texting > 0) {
            $message .= ' We’re texting your live location to '.$texting.' trusted '
                .($texting === 1 ? 'contact' : 'contacts').' now.';
            if ($texting < $contacts->count()) {
                $message .= ' We can’t text the others — call them if you can.';
            }
        } else {
            $message .= ' We can’t text your trusted contacts automatically — call them if you can.';
        }
        $message .= ' If you are in danger, call 911.';

        return [
            'message' => $message,
            'alerted' => [
                // Every SOS rings the alarm on every open admin page and lands
                // in the admin panel's live alerts.
                'safety_team' => true,
                'staff_emails' => $staffEmails,
                'staff_phones' => $staffPhones,
                'trusted_contacts_total' => $contacts->count(),
                'trusted_contacts_texting' => $texting,
            ],
        ];
    }

    /**
     * The phone's GPS fix sent with an SOS, if it is a usable one. A bad or
     * missing fix is ignored rather than rejected: an SOS must never fail
     * because of its location.
     *
     * @param  array<string, mixed>  $input
     * @return array{lat: float, lng: float, accuracy: ?float}|null
     */
    public static function deviceLocationFrom(array $input): ?array
    {
        $lat = $input['lat'] ?? null;
        $lng = $input['lng'] ?? null;

        if (! is_numeric($lat) || ! is_numeric($lng)) {
            return null;
        }

        $lat = (float) $lat;
        $lng = (float) $lng;
        if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180 || ($lat == 0.0 && $lng == 0.0)) {
            return null;
        }

        $accuracy = $input['accuracy'] ?? null;
        $accuracy = is_numeric($accuracy) && (float) $accuracy >= 0 && (float) $accuracy <= 100000
            ? round((float) $accuracy, 1)
            : null;

        return ['lat' => round($lat, 7), 'lng' => round($lng, 7), 'accuracy' => $accuracy];
    }

    /**
     * Where the person who pressed SOS is: the phone's own fix when it sent
     * one; otherwise, for a runner, their last reported position; otherwise
     * the errand's address (drop-off for a customer; for a runner, pick-up
     * until they have collected, drop-off after).
     *
     * @return array{lat: mixed, lng: mixed, accuracy: ?float, source: ?string}
     */
    private function triggerLocation(Booking $booking, string $role, ?array $deviceLocation): array
    {
        if ($deviceLocation !== null) {
            return [
                'lat' => $deviceLocation['lat'],
                'lng' => $deviceLocation['lng'],
                'accuracy' => $deviceLocation['accuracy'],
                'source' => SOSAlert::LOCATION_DEVICE,
            ];
        }

        $profile = $booking->runner?->runnerProfile;
        if ($role === 'runner' && $profile?->current_lat !== null && $profile?->current_lng !== null) {
            return [
                'lat' => $profile->current_lat,
                'lng' => $profile->current_lng,
                'accuracy' => null,
                'source' => SOSAlert::LOCATION_RUNNER_LAST_KNOWN,
            ];
        }

        $beforePickup = in_array($booking->status, ['pending', 'matched', 'accepted', 'heading_to_pickup', 'arrived_at_pickup'], true);
        $usePickup = $role === 'runner' ? $beforePickup : $booking->dropoff_lat === null;
        [$lat, $lng] = $usePickup
            ? [$booking->pickup_lat, $booking->pickup_lng]
            : [$booking->dropoff_lat, $booking->dropoff_lng];

        if ($lat === null || $lng === null) {
            return ['lat' => null, 'lng' => null, 'accuracy' => null, 'source' => null];
        }

        return ['lat' => $lat, 'lng' => $lng, 'accuracy' => null, 'source' => SOSAlert::LOCATION_ERRAND_POINT];
    }

    /** booking.sos_triggered = whether anyone still has an open alert on it. */
    private function syncBookingFlag(Booking $booking): void
    {
        $open = SOSAlert::where('booking_id', $booking->id)
            ->where('status', SOSAlert::STATUS_ACTIVE)
            ->exists();

        if ((bool) $booking->sos_triggered !== $open) {
            $booking->update(['sos_triggered' => $open]);
        }
    }
}
