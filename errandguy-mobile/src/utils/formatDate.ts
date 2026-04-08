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
