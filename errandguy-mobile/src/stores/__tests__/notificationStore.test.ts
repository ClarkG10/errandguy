jest.mock('../../services/notification.service', () => ({
  notificationService: { getUnreadCount: jest.fn() },
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import { useNotificationStore } from '../notificationStore';
import { notificationService } from '../../services/notification.service';
import type { AppNotification } from '../../types';

const getUnreadCount = notificationService.getUnreadCount as jest.Mock;

const row = (id: string, over: Partial<AppNotification> = {}): AppNotification => ({
  id,
  user_id: 'u1',
  title: id,
  body: '',
  type: 'booking_update' as AppNotification['type'],
  data: null,
  is_read: false,
  created_at: '2026-10-31T01:00:00Z',
  ...over,
});

const state = () => useNotificationStore.getState();

beforeEach(() => {
  useNotificationStore.setState({ notifications: [], unreadCount: 0 });
  getUnreadCount.mockReset();
});

describe('the Alerts badge is the server total', () => {
  it('loading a page of rows does NOT reset the badge to the unread rows on screen', () => {
    state().setUnreadCount(34);
    state().setNotifications([row('a'), row('b', { is_read: true }), row('c')]);
    expect(state().unreadCount).toBe(34);
  });

  it('refreshUnreadCount takes the server number', async () => {
    getUnreadCount.mockResolvedValue({ data: { data: { unread_count: 12 } } });
    await state().refreshUnreadCount();
    expect(state().unreadCount).toBe(12);
  });

  it('a failed refresh keeps the badge it had', async () => {
    state().setUnreadCount(5);
    getUnreadCount.mockRejectedValue(new Error('offline'));
    await state().refreshUnreadCount();
    expect(state().unreadCount).toBe(5);
  });

  it('local actions move it by exact deltas', () => {
    state().setUnreadCount(10);
    state().setNotifications([row('a'), row('b', { is_read: true })]);
    state().markRead('a');
    expect(state().unreadCount).toBe(9);
    state().markRead('a'); // idempotent
    expect(state().unreadCount).toBe(9);
    state().remove('b'); // was read — no change
    expect(state().unreadCount).toBe(9);
    state().markAllRead();
    expect(state().unreadCount).toBe(0);
  });

  it('restore puts back the exact list AND badge after a failed bulk action', () => {
    const prev = [row('a'), row('b')];
    state().setNotifications(prev);
    state().setUnreadCount(40);
    state().markAllRead();
    state().restore(prev, 40);
    expect(state().notifications).toBe(prev);
    expect(state().unreadCount).toBe(40);
  });

  it('neither inbox screen counts rows into the badge any more', () => {
    for (const rel of ['app/(customer)/(tabs)/notifications.tsx', 'app/(runner)/notifications.tsx']) {
      const src = readFileSync(join(__dirname, '..', '..', rel), 'utf8');
      expect(src).not.toMatch(/setUnreadCount\([^)]*filter/);
      expect(src).toMatch(/refreshUnreadCount\(\)/);
      expect(src).toMatch(/restore\(prev, prevUnread\)/);
    }
  });
});

describe('a coalesced card coming round again', () => {
  it('replaces the held row with the new payload and moves it to the top', () => {
    state().setNotifications([row('other'), row('card', { data: { tick: 1 }, is_read: true })]);
    const held = state().addNotification(row('card', { data: { tick: 2 }, is_read: false }));
    expect(held).toBe(true);
    expect(state().notifications.map((n) => n.id)).toEqual(['card', 'other']);
    expect(state().notifications[0].data).toEqual({ tick: 2 });
  });

  it('only moves the badge when the read state changed', () => {
    state().setUnreadCount(3);
    state().setNotifications([row('card', { is_read: false })]);
    state().addNotification(row('card', { is_read: false, data: { tick: 2 } }));
    expect(state().unreadCount).toBe(3); // was unread, still unread
    state().setNotifications([row('card', { is_read: true })]);
    state().addNotification(row('card', { is_read: false, data: { tick: 3 } }));
    expect(state().unreadCount).toBe(4); // re-marked unread by the server
  });

  it('a new id is prepended and counted, and reported as not held', () => {
    state().setUnreadCount(1);
    expect(state().addNotification(row('new'))).toBe(false);
    expect(state().notifications[0].id).toBe('new');
    expect(state().unreadCount).toBe(2);
  });
});

it('the unread total is read uncached — a micro-cached body would undo a fresh arrival', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'services', 'notification.service.ts'), 'utf8');
  expect(src).toMatch(/'\/notifications\/unread-count', \{ noCache: true/);
});
