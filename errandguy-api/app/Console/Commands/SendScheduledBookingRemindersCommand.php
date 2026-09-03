<?php

namespace App\Console\Commands;

use App\Models\Booking;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * One "coming up" reminder for a SCHEDULED booking, ~30 minutes before its
 * window opens.
 *
 * A customer can schedule an errand days ahead and then hear nothing between the
 * "Errand booked" push at creation and "Runner found" at scheduled_at−15min
 * (when the deferred MatchRunnerJob fires). That silence swallows the last
 * FREE-cancellation moment: CancellationPolicy charges nothing while a booking is
 * pending/matched, but a flat fee the instant a runner accepts — so a customer
 * whose plans changed only finds out they're committed after the fact.
 *
 * Implemented as a SWEEP (Schedule::command), not a delayed job dispatched at
 * create time, for two reasons: a delayed job queued days out is the first thing
 * lost to a worker restart/flush, and a sweep needs no new column or migration.
 * Idempotency is a cache flag keyed on the booking id — the reminder is a
 * once-per-booking courtesy, so a re-run inside the window (or a second server)
 * must not re-push. Nothing here touches money or booking state.
 */
class SendScheduledBookingRemindersCommand extends Command
{
    protected $signature = 'errandguy:send-scheduled-reminders';

    protected $description = 'Send scheduled-booking customers one reminder ~30 minutes before their window opens.';

    /** How far ahead of scheduled_at the reminder goes out. */
    private const LEAD_MINUTES = 30;

    /**
     * Bound each sweep so a burst of same-slot bookings can't blow memory or run
     * past the cadence; the rest are picked up by the next run (still inside the
     * window, since the window is wider than the cadence).
     */
    private const MAX_PER_RUN = 500;

    /**
     * Flag TTL. Only ever set once a booking is inside its 30-minute window, and
     * a booking leaves that window for good once scheduled_at passes, so a day is
     * far more than enough to make the reminder once-only.
     */
    private const FLAG_TTL_SECONDS = 86400;

    public function handle(): int
    {
        $now = now();
        $sent = 0;
        $skipped = 0;

        // Still awaiting/holding a runner (never cancelled, completed or
        // no_runner) and inside [now, now + lead]. `scheduled_at >= now` keeps a
        // late sweep from reminding about a window that already opened.
        $bookings = Booking::query()
            ->where('schedule_type', 'scheduled')
            ->whereNotNull('scheduled_at')
            ->whereNotNull('customer_id')
            ->whereIn('status', ['pending', 'matched', 'accepted'])
            ->where('scheduled_at', '>=', $now)
            ->where('scheduled_at', '<=', $now->copy()->addMinutes(self::LEAD_MINUTES))
            ->with('errandType:id,slug')
            ->orderBy('scheduled_at')
            ->limit(self::MAX_PER_RUN)
            ->get();

        foreach ($bookings as $booking) {
            // Booked from INSIDE its own reminder window (e.g. "scheduled" for
            // 20 minutes from now): the creation confirmation already told them,
            // and a "coming up" push minutes later is pure noise. Compared in PHP
            // so this stays cross-engine (no DB date arithmetic).
            if ($booking->created_at
                && $booking->created_at->gt($booking->scheduled_at->copy()->subMinutes(self::LEAD_MINUTES))) {
                $skipped++;

                continue;
            }

            // Claim-then-send: Cache::add is atomic, so only one sweep (or one
            // server) ever gets past this for a given booking.
            if (! Cache::add("booking-scheduled-reminder:{$booking->id}", true, self::FLAG_TTL_SECONDS)) {
                $skipped++;

                continue;
            }

            try {
                [$title, $body] = $this->copyFor($booking);

                app(\App\Services\NotificationService::class)->sendPush(
                    $booking->customer_id,
                    $title,
                    $body,
                    [
                        'type' => 'booking_update',
                        'booking_id' => $booking->id,
                        'status' => $booking->status,
                        'reason' => 'scheduled_reminder',
                        'scheduled_at' => optional($booking->scheduled_at)->toIso8601String(),
                    ],
                );
                $sent++;
            } catch (\Throwable $e) {
                // Release the claim so the next sweep can retry inside the window.
                Cache::forget("booking-scheduled-reminder:{$booking->id}");
                Log::warning('SendScheduledBookingRemindersCommand: reminder failed', [
                    'booking_id' => $booking->id, 'error' => $e->getMessage(),
                ]);
            }
        }

        $this->info("Sent {$sent} scheduled-booking reminder(s) (skipped {$skipped} already reminded).");

        return self::SUCCESS;
    }

    /**
     * Errand-type-aware copy, mirroring the SendBookingStatusNotification
     * override pattern: a passenger ride is a "ride" with a driver, everything
     * else is an "errand" with a runner. Times are rendered in Asia/Manila (the
     * DB stores UTC) — same convention as the admin dashboard header.
     *
     * @return array{0: string, 1: string}
     */
    private function copyFor(Booking $booking): array
    {
        $number = $booking->booking_number ?? $booking->id;
        $time = optional($booking->scheduled_at)->timezone('Asia/Manila')->format('g:i A') ?? 'soon';
        $freeCancel = in_array($booking->status, ['pending', 'matched'], true);

        if ($booking->errandType?->slug === 'transportation') {
            return [
                'Your ride is coming up',
                "Your scheduled ride #{$number} starts at {$time}."
                    .($freeCancel ? ' Cancelling is still free until a driver accepts.' : ''),
            ];
        }

        return [
            'Your errand is coming up',
            "Your scheduled errand #{$number} starts at {$time}."
                .($freeCancel ? ' Cancelling is still free until a runner accepts.' : ''),
        ];
    }
}
