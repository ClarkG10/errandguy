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
