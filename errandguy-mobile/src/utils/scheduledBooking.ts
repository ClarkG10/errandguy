import dayjs from 'dayjs';
import type { Booking } from '../types';

/**
 * A scheduled booking is broadcast to runners at scheduled_at − 15min, and
 * sits at status `pending` (no search running) until then. Mirrors the
 * server-side lead used by MatchRunnerJob and the runner offer feed.
 */
export const SCHEDULED_MATCH_LEAD_MINUTES = 15;

/**
 * Calendar-style label for a scheduled errand ("Tomorrow, 9:00 AM").
 * Same day-bucketing idiom as formatChatDayLabel, with the time appended —
 * a bare "Aug 30, 9:00 AM" makes the reader do the date maths.
 */
export function formatScheduledLabel(at: dayjs.Dayjs): string {
  const diffDays = at.startOf('day').diff(dayjs().startOf('day'), 'day');
  const time = at.format('h:mm A');
  if (diffDays <= 0) return `Today, ${time}`;
  if (diffDays === 1) return `Tomorrow, ${time}`;
  if (diffDays < 7) return `${at.format('dddd')}, ${time}`;
  return `${at.format('MMM D')}, ${time}`;
}

/**
 * Is this booking waiting for a FUTURE scheduled window rather than being
 * actively searched for right now?
 *
 * A `pending` scheduled booking is indistinguishable from a live search by
 * status alone, so surfaces that bucket on status told the customer "Looking
 * for a runner…" — with a pulsing dot — for an errand scheduled next Tuesday.
 * That reads as a stuck search and drives cancellations and support chats.
 *
 * Returns the formatted window label when the booking is genuinely waiting,
 * or null once its matching window has opened (at which point "looking for a
 * runner" is the truth).
 */
export function scheduledWindowLabel(
  booking: Pick<Booking, 'status' | 'schedule_type' | 'scheduled_at'> | null | undefined,
): string | null {
  if (!booking) return null;
  if (booking.status !== 'pending') return null;
  if (booking.schedule_type !== 'scheduled') return null;
  if (!booking.scheduled_at) return null;

  const at = dayjs(booking.scheduled_at);
  if (!at.isValid()) return null;
  if (at.subtract(SCHEDULED_MATCH_LEAD_MINUTES, 'minute').isBefore(dayjs())) {
    return null;
  }
  return formatScheduledLabel(at);
}
