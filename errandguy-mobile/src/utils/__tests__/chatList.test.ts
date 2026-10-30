import dayjs from 'dayjs';
import { buildChatRows } from '../chatList';
import { formatChatDayLabel, formatTime, formatDateTime, formatRelativeTime } from '../formatDate';
import type { Message } from '../../types';

const msg = (id: string, created_at: any): Message => ({
  id,
  booking_id: 'b1',
  sender_id: 'u1',
  content: id,
  image_url: null,
  is_system: false,
  read_at: null,
  created_at,
});

const at = (daysAgo: number, hour: number) =>
  dayjs().subtract(daysAgo, 'day').hour(hour).minute(0).second(0).toISOString();

/** The rows as they paint in the inverted list: top of the screen first. */
const topToBottom = (rows: ReturnType<typeof buildChatRows>) =>
  [...rows].reverse().map((r) => (r.kind === 'day' ? `[${r.label}]` : r.message.id));

describe('chat day separators', () => {
  it('heads each day with ONE pill naming that day', () => {
    const rows = buildChatRows([
      msg('y1', at(1, 9)),
      msg('y2', at(1, 10)),
      msg('t1', at(0, 0)),
      msg('t2', at(0, 0)),
    ]);
    expect(topToBottom(rows)).toEqual(['[Yesterday]', 'y1', 'y2', '[Today]', 't1', 't2']);
  });

  it('a single-day thread has exactly one "Today"', () => {
    const rows = buildChatRows([msg('a', at(0, 0)), msg('b', at(0, 0)), msg('c', at(0, 0))]);
    expect(rows.filter((r) => r.kind === 'day')).toHaveLength(1);
    expect(topToBottom(rows)[0]).toBe('[Today]');
  });

  it('an undated message joins its neighbours instead of opening a second "Today"', () => {
    const rows = buildChatRows([msg('a', at(0, 0)), msg('b', null), msg('c', at(0, 0))]);
    const pills = rows.filter((r) => r.kind === 'day');
    expect(pills).toHaveLength(1);
    expect(pills.every((p) => p.kind === 'day' && p.label === 'Today')).toBe(true);
  });

  it('never labels anything "Invalid Date"', () => {
    const rows = buildChatRows([msg('a', null), msg('b', 'not a date')]);
    for (const r of rows) if (r.kind === 'day') expect(r.label).not.toMatch(/Invalid/);
  });
});

describe('date formatting never prints "Invalid Date"', () => {
  it.each([null, undefined, '', 'nonsense'])('%p → empty', (value) => {
    expect(formatTime(value as any)).toBe('');
    expect(formatDateTime(value as any)).toBe('');
    expect(formatRelativeTime(value as any)).toBe('');
    expect(formatChatDayLabel(value as any)).toBe('');
  });

  it('still formats a real timestamp', () => {
    expect(formatTime('2026-10-31T09:05:00')).toBe('9:05 AM');
  });
});
