import { readFileSync } from 'fs';
import { join } from 'path';
import { pendingNotificationDeletes } from '../pendingNotificationDeletes';
import { useAuthStore } from '../../stores/authStore';

/**
 * The "Notification deleted · Undo" toast outlives the inbox. Leaving the inbox
 * used to send every pending delete at once and forget it, so Undo on the next
 * screen did nothing; and a sign-out sent them after the token was gone.
 */
describe('pendingNotificationDeletes', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    pendingNotificationDeletes.cancelAll();
    useAuthStore.setState({ isAuthenticated: true });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends the delete only when the Undo window closes', () => {
    const send = jest.fn();
    pendingNotificationDeletes.schedule('n-1', 5000, send);

    jest.advanceTimersByTime(4999);
    expect(send).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('Undo cancels it — and says whether it was still in time', () => {
    const send = jest.fn();
    pendingNotificationDeletes.schedule('n-1', 5000, send);

    expect(pendingNotificationDeletes.cancel('n-1')).toBe(true);
    jest.advanceTimersByTime(10000);
    expect(send).not.toHaveBeenCalled();
    // The window had closed already: nothing left to undo.
    expect(pendingNotificationDeletes.cancel('n-1')).toBe(false);
  });

  it('signing out cancels every pending delete', () => {
    const send = jest.fn();
    pendingNotificationDeletes.schedule('n-1', 5000, send);
    pendingNotificationDeletes.schedule('n-2', 5000, send);

    useAuthStore.setState({ isAuthenticated: false });
    jest.advanceTimersByTime(10000);

    expect(send).not.toHaveBeenCalled();
  });
});

describe('the inboxes keep the Undo window open after they unmount', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', 'app', ...p), 'utf8');
  const inboxes = {
    customer: read('(customer)', '(tabs)', 'notifications.tsx'),
    runner: read('(runner)', 'notifications.tsx'),
  };

  it.each(Object.entries(inboxes))('%s: schedules through the shared registry and never flushes on unmount', (_role, src) => {
    expect(src).toContain('pendingNotificationDeletes.schedule(item.id, UNDO_DELETE_MS,');
    expect(src).toContain('if (!pendingNotificationDeletes.cancel(item.id)) return;');
    expect(src).not.toMatch(/pendingDeletes/);
    // No unmount cleanup that sends deletes early.
    expect(src).not.toMatch(/return \(\) => \{[\s\S]{0,200}deleteNotification/);
  });
});
