<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\SOSAlert;
use App\Models\TrustedContact;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SOSService
{
    public function __construct(
        private NotificationService $notificationService,
    ) {}

    /**
     * Trigger an SOS alert for a booking.
     *
     * @param  string  $bookingId
     * @param  string  $triggeredBy  user-id of the person pulling the alarm
     * @param  string  $role         'customer' or 'runner'
     */
    public function triggerSOS(string $bookingId, string $triggeredBy, string $role = 'customer'): SOSAlert
    {
        $created = false;
        $bookingLabel = null;

        // Serialize concurrent panic-button presses for the SAME booking on the
        // booking row. Two triggers at once — e.g. the customer AND the runner,
        // who are different users so the per-user throttle does NOT serialize
        // them — would each read "no active alert" and each insert one, leaving a
        // duplicate active alert that deactivateSOS then orphans. Locking the
        // booking row makes the second trigger wait, re-read, and return the
        // first's alert. On SQLite lockForUpdate is a no-op (writes serialize
        // globally); on MySQL it is a real row lock. (audit safety)
        $alert = DB::transaction(function () use ($bookingId, $triggeredBy, $role, &$created, &$bookingLabel) {
            $booking = Booking::with(['runner.runnerProfile'])
                ->lockForUpdate()
                ->findOrFail($bookingId);

            $bookingLabel = $booking->booking_number ?? $booking->id;

            // Idempotency — an active alert already exists for this booking.
            $existing = SOSAlert::where('booking_id', $bookingId)
                ->where('status', 'active')
                ->latest('triggered_at')
                ->first();
            if ($existing) {
                return $existing;
            }

            $runnerProfile = $booking->runner?->runnerProfile;

            $alert = SOSAlert::create([
                'booking_id' => $bookingId,
                'customer_id' => $booking->customer_id,
                'runner_id' => $booking->runner_id,
                'triggered_by' => $triggeredBy,
                'triggered_by_role' => $role,
                'triggered_at' => now(),
                'customer_lat' => $booking->dropoff_lat,
                'customer_lng' => $booking->dropoff_lng,
                'runner_lat' => $runnerProfile?->current_lat,
                'runner_lng' => $runnerProfile?->current_lng,
                'live_link_token' => Str::random(64),
                'live_link_expires_at' => now()->addMinutes(60),
                'status' => 'active',
            ]);

            // WHICH trusted contacts will be notified — part of the durable
            // safety record, so it stays inside the transaction.
            $contactIds = TrustedContact::where('user_id', $triggeredBy)
                ->orderBy('created_at')
                ->pluck('id')
                ->toArray();
            $alert->update(['contacts_notified' => $contactIds]);

            $booking->update(['sos_triggered' => true]);

            $created = true;

            return $alert;
        });

        // Side-effects run AFTER commit and ONLY for a newly created alert (an
        // idempotent replay must not re-alert): a best-effort operator alert or
        // the queued fan-out can never roll back the durable safety write, and
        // the job can't run against a not-yet-committed row. The outbound fan-out
        // (trusted-contact SMS, the Reverb broadcast, the admin FCM topic) is
        // deferred to a job so the panic button returns immediately. (P7)
        if ($created) {
            \App\Models\AdminAlert::raise(
                'sos',
                'critical',
                'SOS triggered',
                'Booking '.$bookingLabel.' — '.$role.' pulled the alarm.',
                $alert->id,
            );

            \App\Jobs\NotifySosContactsJob::dispatch($alert->id);
        }

        return $alert;
    }

    public function deactivateSOS(string $bookingId): void
    {
        $runnerId = null;
        $alertId = null;

        // Resolve EVERY active alert for the booking, not just the latest: a
        // pre-existing duplicate active alert would otherwise be orphaned — left
        // active in getActiveSOS() while booking.sos_triggered is cleared. Lock
        // the booking row (as triggerSOS does) so a concurrent trigger can't
        // interleave and leave the flag and the alerts inconsistent. (audit safety)
        $resolved = DB::transaction(function () use ($bookingId, &$runnerId, &$alertId) {
            $booking = Booking::whereKey($bookingId)->lockForUpdate()->first();
            if (!$booking) {
                return false;
            }

            $latestActive = SOSAlert::where('booking_id', $bookingId)
                ->where('status', 'active')
                ->latest('triggered_at')
                ->first();
            if (!$latestActive) {
                return false;
            }

            $alertId = $latestActive->id;
            $runnerId = $booking->runner_id;

            SOSAlert::where('booking_id', $bookingId)
                ->where('status', 'active')
                ->update([
                    'status' => 'resolved',
                    'resolved_at' => now(),
                ]);

            $booking->update(['sos_triggered' => false]);

            return true;
        });

        if (!$resolved) {
            return;
        }

        // Tell the runner the emergency was resolved, live over their
        // `notifications.{userId}` Reverb channel. AFTER commit — a broadcast
        // must not fire on a not-yet-committed resolve. Broadcast-only, no push.
        if ($runnerId) {
            $this->notificationService->notifyInApp(
                $runnerId,
                'SOS resolved',
                'The emergency alert has been resolved.',
                [
                    'type' => 'sos',
                    'booking_id' => $bookingId,
                    'alert_id' => $alertId,
                    'status' => 'resolved',
                ],
            );
        }
    }

    public function getActiveSOS(): \Illuminate\Database\Eloquent\Collection
    {
        return SOSAlert::where('status', 'active')
            ->with(['booking', 'customer', 'runner'])
            ->orderByDesc('triggered_at')
            ->get();
    }
}
