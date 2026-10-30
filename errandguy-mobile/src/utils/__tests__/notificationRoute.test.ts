import { notificationRoute, notificationsInboxRoute } from '../notificationRoute';

/**
 * One map for the push tap and both inboxes. The two failures it exists to
 * prevent: a "Support replied" push that opened nothing (or the inbox list
 * instead of the thread), and staff announcements / status notes that
 * dead-ended on whatever screen the app happened to be showing.
 */
describe('notificationRoute', () => {
  it('opens the support THREAD a reply is about — for both roles', () => {
    const reply = { type: 'support_reply', data: { type: 'support_reply', ticket_id: 'tk-1' } };
    expect(notificationRoute(reply, 'customer', 'push')).toBe('/(customer)/support/tk-1');
    expect(notificationRoute(reply, 'runner', 'push')).toBe('/(customer)/support/tk-1');
    expect(notificationRoute(reply, 'customer', 'inbox')).toBe('/(customer)/support/tk-1');
  });

  it('a ticket status change opens its thread, or the support inbox without an id', () => {
    expect(
      notificationRoute({ type: 'support_status', data: { ticket_id: 7, status: 'resolved' } }, 'runner', 'push'),
    ).toBe('/(customer)/support/7');
    expect(notificationRoute({ type: 'support_status', data: {} }, 'customer', 'push')).toBe(
      '/(customer)/support',
    );
  });

  it('a staff announcement opens the notifications screen from a push, and stays put in the inbox', () => {
    const b = { type: 'broadcast', data: { type: 'broadcast' } };
    expect(notificationRoute(b, 'customer', 'push')).toBe('/(customer)/(tabs)/notifications');
    expect(notificationRoute(b, 'runner', 'push')).toBe('/(runner)/notifications');
    expect(notificationRoute(b, 'customer', 'inbox')).toBeNull();
  });

  it('unknown types never dead-end a push', () => {
    expect(notificationRoute({ type: 'something_new', data: {} }, 'runner', 'push')).toBe(
      notificationsInboxRoute('runner'),
    );
  });

  it('reads the type from the data bag when the column is absent (raw push payload)', () => {
    expect(notificationRoute({ data: { type: 'support_reply', ticket_id: 'tk-9' } }, 'customer', 'push')).toBe(
      '/(customer)/support/tk-9',
    );
  });

  it('errand notifications route by role — runner cockpit vs customer tracking', () => {
    const n = { type: 'booking_update', data: { booking_id: 'bk-1' } };
    expect(notificationRoute(n, 'runner', 'push')).toBe('/(runner)/errand/bk-1');
    expect(notificationRoute(n, 'customer', 'inbox')).toBe('/(customer)/tracking/bk-1');
    expect(notificationRoute({ type: 'sos', data: { booking_id: 'bk-2', status: 'resolved' } }, 'runner', 'inbox')).toBe(
      '/(runner)/errand/bk-2',
    );
  });

  it('a staff note about an errand taken OFF a runner opens their inbox, not a cockpit they can’t load', () => {
    const n = { type: 'system', data: { booking_id: 'bk-1', reason: 'returned_to_matching' } };
    expect(notificationRoute(n, 'runner', 'push')).toBe('/(runner)/notifications');
    expect(notificationRoute(n, 'customer', 'push')).toBe('/(customer)/tracking/bk-1');
  });

  it('keeps the money and document destinations', () => {
    expect(notificationRoute({ type: 'payment', data: { booking_id: 'bk-1' } }, 'customer', 'push')).toBe(
      '/(customer)/tracking/bk-1',
    );
    expect(notificationRoute({ type: 'payment', data: {} }, 'customer', 'inbox')).toBe('/(customer)/wallet');
    expect(notificationRoute({ type: 'payment', data: { booking_id: 'bk-1' } }, 'runner', 'push')).toBe(
      '/(runner)/(tabs)/earnings',
    );
    expect(notificationRoute({ type: 'onboarding_reminder', data: {} }, 'runner', 'inbox')).toBe(
      '/(runner)/settings/documents',
    );
    expect(notificationRoute({ type: 'chat', data: { booking_id: 'bk-1' } }, 'runner', 'push')).toBe(
      '/(runner)/chat/bk-1',
    );
  });
});
