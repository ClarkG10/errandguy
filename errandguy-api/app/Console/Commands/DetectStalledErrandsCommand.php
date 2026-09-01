<?php

namespace App\Console\Commands;

use App\Models\AdminAlert;
use App\Models\Booking;
use App\Models\SystemConfig;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Stall detector for errands a runner is already holding.
 *
 * Until now the ONLY duration monitor was CheckRideDurationJob, which filters
 * `is_transportation = true AND status = 'in_transit'`. A delivery runner who
 * accepts and then never moves — or picks up and vanishes — was detected by
 * nothing at all: no admin alert, no log line, no signal to anyone. The customer
 * sat on the tracking screen watching a frozen pin and had to notice the problem
 * themselves.
 *
 * DETECTION SIGNAL — `bookings.updated_at`, deliberately, NOT
 * `runner_profiles.last_location_at`:
 *   - every status transition writes the booking row, and so does a shopping
 *     checklist tick (ShoppingChecklistController) and a customer list edit —
 *     all of which correctly count as progress; and
 *   - LocationService writes GPS to `runner_locations` / `runner_profiles` and
 *     never touches the booking row, so `last_location_at` goes stale the moment
 *     the app is backgrounded (background GPS is deferred). Keying on it would
 *     alert on every runner who locked their phone.
 *
 * SCOPE — NOTIFY-ONLY. This raises an operator alert and nothing else. It does
 * not cancel, re-assign, penalise the runner or compensate the customer: every
 * one of those needs a fee/penalty policy decision that has not been made. It
 * moves no money and mutates no booking state.
 *
 * NOISE CONTROL:
 *   - thresholds start GENEROUS and are per-status SystemConfig-tunable
 *     (`stall_alert_minutes_{status}`); `0` disables one status, and
 *     `stall_alert_enabled = 0` is the global kill switch;
 *   - a scheduled booking accepted a day early is NOT stalled, so a scheduled
 *     booking only ages from its own `scheduled_at` (same anchor rule as
 *     ReapStrandedBookingsCommand::scheduleAwareWindow);
 *   - a booking with a live SOS is skipped — that alarm already has its own
 *     critical alert and fan-out; and
 *   - one alert per booking, claimed atomically with Cache::add, so a re-run,
 *     a second server, or a later status stalling too cannot re-raise.
 *
 * SCHEDULE (routes/console.php owns registration): run INLINE via
 * Schedule::command — like reap-stranded-bookings — so the detector survives a
 * queue-worker outage, which is precisely one of the ways an errand stalls.
 */
class DetectStalledErrandsCommand extends Command
{
    protected $signature = 'errandguy:detect-stalled-errands
        {--dry-run : Report what would be alerted without raising anything or consuming the once-per-booking flag}';

    protected $description = 'Raise an admin alert for errands sitting in a runner-held status with no progress past their per-status threshold. Notify-only — no cancel, re-assign or penalty.';

    /**
     * Runner-held statuses and their DEFAULT idle threshold in minutes.
     *
     * Deliberately generous: a false "stalled" alert costs an operator's
     * attention, and the point of the first deployment is to learn the real
     * distribution before tightening. Ordered as the errand flows.
     *
     * 'delivered' is intentionally absent — it waits on the CUSTOMER's confirm
     * tap, not the runner, so idling there is not a runner stall. 'pending' and
     * 'matched' are absent too: no runner holds those, and ExpireStaleMatchesJob
     * / ReapStrandedBookingsCommand already cover them.
     */
    private const DEFAULT_THRESHOLDS = [
        'accepted' => 30,
        'heading_to_pickup' => 30,
        'arrived_at_pickup' => 45,
        'picked_up' => 60,
        'in_transit' => 60,
        'arrived_at_dropoff' => 30,
    ];

    /** Human labels for the alert body — mirrors the admin BookingsTable. */
    private const STATUS_LABELS = [
        'accepted' => 'Accepted',
        'heading_to_pickup' => 'Heading to pickup',
        'arrived_at_pickup' => 'Arrived at pickup',
        'picked_up' => 'Picked up',
        'in_transit' => 'In transit',
        'arrived_at_dropoff' => 'Arrived at dropoff',
    ];

    /**
     * Bounds on a configured threshold, so a typo in system_config can neither
     * spam the alert feed (1 minute) nor silence the detector for a week.
     */
    private const MIN_MINUTES = 5;

    private const MAX_MINUTES = 1440;

    /** Alerts raised per status per run — bounds memory and the alert feed. */
    private const MAX_PER_RUN = 200;

    /**
     * Alert cadence per booking. Within one window a booking alerts once, no
     * matter how many statuses it stalls through — but a booking that is STILL
     * stalled when the flag expires alerts again. That re-fire is deliberate:
     * nothing reaps a runner-held status (the reapers only cover
     * pending/no_runner), so an ignored stall would otherwise go silent
     * forever after its single alert. Six hours is the escalation drumbeat,
     * not a leak.
     */
    private const FLAG_TTL_SECONDS = 21600; // 6 hours

    public function handle(): int
    {
        if (SystemConfig::getValue('stall_alert_enabled', '1') === '0') {
            $this->line('<comment>Stall detection is disabled</comment> (system_config `stall_alert_enabled` = 0).');

            return self::SUCCESS;
        }

        $dryRun = (bool) $this->option('dry-run');
        $now = now();
        $raised = 0;
        $skipped = 0;

        foreach (self::DEFAULT_THRESHOLDS as $status => $defaultMinutes) {
            $minutes = $this->thresholdFor($status, $defaultMinutes);
            if ($minutes === null) {
                continue; // this status's monitor is switched off
            }

            $cutoff = $now->copy()->subMinutes($minutes);

            $query = Booking::query()
                ->where('status', $status)
                ->whereNotNull('runner_id')
                ->where('sos_triggered', false)
                ->where('updated_at', '<', $cutoff)
                // A scheduled booking a runner accepted well in advance is
                // waiting, not stalled: age it from its own scheduled_at.
                ->where(function ($q) use ($cutoff) {
                    $q->where('schedule_type', '!=', 'scheduled')
                        ->orWhereNull('schedule_type')
                        ->orWhereNull('scheduled_at')
                        ->orWhere('scheduled_at', '<', $cutoff);
                })
                ->orderBy('updated_at')
                ->limit(self::MAX_PER_RUN);

            // A transportation ride in transit is ALREADY monitored by
            // CheckRideDurationJob, which judges it against a distance-derived
            // estimate rather than a flat clock — and a genuine hour-long ride
            // writes nothing to the booking row while it is going perfectly
            // well. Leave that exact slice to the better detector so the feed
            // doesn't carry two alerts (or a false one) for the same trip.
            // Every OTHER status of a ride is still covered here: nothing else
            // watches a driver who accepted and never set off.
            if ($status === 'in_transit') {
                $query->where('is_transportation', false);
            }

            $bookings = $query->get(['id', 'booking_number', 'status', 'updated_at', 'customer_id', 'runner_id']);

            // The cap is applied BEFORE the already-alerted cache skip, so if
            // an entire window's worth of rows is already flagged, rows past
            // the cap were never even fetched — the window is saturated and
            // newer stalls in this status are invisible until the head clears.
            // That takes 200+ chronically stalled bookings in ONE status
            // (a platform catastrophe with louder alarms than this one), but
            // it must not be SILENT if it happens.
            $windowSaturated = $bookings->count() === self::MAX_PER_RUN;
            $skippedThisStatus = 0;

            foreach ($bookings as $booking) {
                $idle = (int) $booking->updated_at->diffInMinutes($now);
                $label = $booking->booking_number ?? $booking->id;
                $statusLabel = self::STATUS_LABELS[$status] ?? $status;

                if ($dryRun) {
                    $this->line("  would alert: {$label} — {$statusLabel} for {$idle}min (threshold {$minutes}min)");
                    $raised++;

                    continue;
                }

                // Claim-then-raise: Cache::add is atomic, so only one run (or one
                // server) ever alerts for a given booking.
                if (! Cache::add("stalled_errand_alert:{$booking->id}", true, self::FLAG_TTL_SECONDS)) {
                    $skipped++;
                    $skippedThisStatus++;

                    continue;
                }

                Log::warning('Stalled errand detected', [
                    'booking_id' => $booking->id,
                    'status' => $status,
                    'idle_minutes' => $idle,
                    'threshold_minutes' => $minutes,
                ]);

                // Best-effort by design (AdminAlert::raise swallows failures) —
                // this is a monitor, it must never become the thing that breaks.
                AdminAlert::raise(
                    'stalled_errand',
                    'warning',
                    'Errand may be stalled',
                    "Booking {$label} has sat in \"{$statusLabel}\" for {$idle} minutes with no progress (threshold {$minutes} min).",
                    $booking->id,
                );

                $raised++;
            }

            if ($windowSaturated && $skippedThisStatus === $bookings->count()) {
                Log::warning('Stall detection window saturated — newer stalls in this status are not being scanned', [
                    'status' => $status,
                    'cap' => self::MAX_PER_RUN,
                ]);
            }
        }

        $this->info(($dryRun ? '[dry-run] ' : '')."Raised {$raised} stalled-errand alert(s) (skipped {$skipped} already alerted).");

        return self::SUCCESS;
    }

    /**
     * Resolve a status's idle threshold from system_config, clamped to sane
     * bounds. Returns null when the status monitor is explicitly disabled
     * (a configured value of 0 or less).
     */
    private function thresholdFor(string $status, int $default): ?int
    {
        // Pass the default through so the lookup is cacheable (SystemConfig's
        // Cache::remember never stores a null).
        $configured = SystemConfig::getValue("stall_alert_minutes_{$status}", (string) $default);

        if ($configured === null || ! is_numeric($configured)) {
            return $default;
        }

        $minutes = (int) $configured;

        if ($minutes <= 0) {
            return null;
        }

        return max(self::MIN_MINUTES, min($minutes, self::MAX_MINUTES));
    }
}
