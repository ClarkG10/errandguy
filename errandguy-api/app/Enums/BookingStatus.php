<?php

namespace App\Enums;

/**
 * Canonical lifecycle of a Booking — the ONLY legal values for
 * `bookings.status`.
 *
 * WHY THIS EXISTS. The statuses themselves were never really in doubt; what was
 * in doubt was the SETS. Two different groupings were spelled out as raw arrays
 * in ~18 places, and they differ by exactly one member:
 *
 *     ['completed', 'cancelled', 'no_runner']     ← 8 sites
 *     ['completed', 'cancelled']                  ← 10 sites
 *
 * Read side by side, the second looks like somebody forgetting `no_runner`. It
 * isn't — the two encode genuinely different questions, and conflating them
 * breaks real behaviour in opposite directions. {@see self::ENDED} and
 * {@see self::FINALIZED} name them so the next reader doesn't have to
 * reconstruct the distinction from the call site (or "fix" one into the other).
 *
 * The trap in particular: `Booking::scopeActive()` deliberately treats a
 * `no_runner` booking as still active, because that is the state the customer
 * retries from ({@see \App\Policies\BookingPolicy::retryMatch}) and the
 * tracking screen's one-tap "Book again" needs the row to be visible. "Tidying"
 * that scope to match the longer set would silently hide a retryable errand —
 * along with the money already refunded against it — from the person who has to
 * act on it.
 */
enum BookingStatus: string
{
    case Pending = 'pending';                       // created; matching is looking
    case Matched = 'matched';                       // a runner was picked, not yet accepted
    case Accepted = 'accepted';                     // the runner took it
    case HeadingToPickup = 'heading_to_pickup';
    case ArrivedAtPickup = 'arrived_at_pickup';
    case PickedUp = 'picked_up';                    // also "work done" for bills/queue flows
    case InTransit = 'in_transit';
    case ArrivedAtDropoff = 'arrived_at_dropoff';
    case Delivered = 'delivered';                   // skipped by the transport flow
    case Completed = 'completed';
    case Cancelled = 'cancelled';
    case NoRunner = 'no_runner';                    // matching exhausted every candidate

    /**
     * "This errand is OVER — nobody is working it."
     *
     * The question asked by anything summarising or displaying live work: the
     * chat inbox's active/archived split, the customer's in-progress count, the
     * public trip page's `is_ended`, the admin dashboard's active-bookings
     * tiles, and CancellationPolicy (nothing left to charge a fee against).
     *
     * Includes `no_runner`: no runner is en route, so for every one of those
     * purposes the errand is not live — even though the customer may still
     * revive it.
     *
     * @return list<string>
     */
    public const ENDED = ['completed', 'cancelled', 'no_runner'];

    /**
     * "This booking has reached a SETTLED outcome and cannot be worked,
     * messaged, or cancelled again."
     *
     * The question asked by write guards: the admin-cancel precondition, the
     * runner's closed-errand checks, the chat composer, the shopping checklist.
     *
     * Excludes `no_runner` on purpose — that row is still revivable (retryMatch)
     * and still cancellable, so it has NOT reached a settled outcome. Note the
     * asymmetry that makes this set the narrower one: even `cancelled` is
     * revivable when the cancellation was the auto-cancel safety net firing
     * rather than a deliberate act.
     *
     * @return list<string>
     */
    public const FINALIZED = ['completed', 'cancelled'];

    /** Every legal status, as raw strings. */
    public static function values(): array
    {
        return array_map(fn (self $c) => $c->value, self::cases());
    }

    /** True when nobody is working this errand any more. */
    public static function isEnded(?string $status): bool
    {
        return in_array((string) $status, self::ENDED, true);
    }

    /** True when this booking has a settled outcome and admits no further work. */
    public static function isFinalized(?string $status): bool
    {
        return in_array((string) $status, self::FINALIZED, true);
    }
}
