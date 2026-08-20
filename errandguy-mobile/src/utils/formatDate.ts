import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export function formatRelativeTime(date: string | Date): string {
  return dayjs(date).fromNow();
}

export function formatFullDate(date: string | Date): string {
  return dayjs(date).format('MMMM D, YYYY');
}

export function formatShortDate(date: string | Date): string {
  return dayjs(date).format('MMM D, YYYY');
}

export function formatTime(date: string | Date): string {
  return dayjs(date).format('h:mm A');
}

export function formatDateTime(date: string | Date): string {
  return dayjs(date).format('MMM D, YYYY h:mm A');
}

export function formatDateForAPI(date: Date): string {
  return dayjs(date).toISOString();
}

/**
 * Local-timezone calendar-day key ("YYYY-MM-DD") for grouping rows by day.
 *
 * Day separators must group by the SAME local day that formatChatDayLabel
 * renders — NOT by a raw UTC slice of the server timestamp. Slicing the
 * first 10 chars of "2026-08-20T23:00:00Z" yields the UTC date, which for
 * UTC+8 (PH) users is off by up to 8h from the local day the label shows,
 * so messages straddling local midnight get split or merged incorrectly.
 */
export function localDayKey(date: string | Date): string {
  return dayjs(date).format('YYYY-MM-DD');
}

/**
 * Friendly day-separator label used in chat lists.
 *  - "Today"     for the current calendar day
 *  - "Yesterday" for the previous calendar day
 *  - weekday name (e.g. "Wednesday") for anything within the past 6 days
 *  - "MMM D, YYYY" otherwise
 */
export function formatChatDayLabel(date: string | Date): string {
  const d = dayjs(date).startOf('day');
  const today = dayjs().startOf('day');
  const diff = today.diff(d, 'day');
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.format('dddd');
  return d.format('MMM D, YYYY');
}
