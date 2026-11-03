import { renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  IDLE_REMINDER_AFTER_SECONDS,
  IDLE_REMINDER_ID,
  useRunnerIdleReminder,
} from '../useRunnerIdleReminder';

/**
 * A locked phone stops sending location (no background location, by design):
 * matching drops the runner at 15 minutes and the server only says so at 30.
 * The app nudges them at 12 — scheduled as they leave, cancelled the moment
 * they're back, offline, or on a job.
 */

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

const schedule = Notifications.scheduleNotificationAsync as jest.Mock;
const cancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;

let appStateListener: ((state: string) => void) | null = null;
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  appStateListener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: any) => {
    appStateListener = fn;
    return { remove };
  }) as any);
});

const flush = () => new Promise((r) => setImmediate(r));

describe('useRunnerIdleReminder', () => {
  it('schedules the reminder ~12 minutes out when an idle online runner leaves the app', async () => {
    renderHook(() => useRunnerIdleReminder(true));

    appStateListener?.('background');
    await flush();

    expect(IDLE_REMINDER_AFTER_SECONDS).toBe(12 * 60);
    expect(schedule).toHaveBeenCalledTimes(1);
    const req = schedule.mock.calls[0][0];
    expect(req.identifier).toBe(IDLE_REMINDER_ID);
    expect(req.content.body).toBe('Open ErrandGuy to keep getting errands.');
    expect(req.trigger).toMatchObject({
      type: 'timeInterval',
      seconds: IDLE_REMINDER_AFTER_SECONDS,
      channelId: 'default',
    });
  });

  it('cancels it when the runner comes back', async () => {
    renderHook(() => useRunnerIdleReminder(true));
    appStateListener?.('background');
    await flush();
    cancel.mockClear();

    appStateListener?.('active');

    expect(cancel).toHaveBeenCalledWith(IDLE_REMINDER_ID);
  });

  it('does not leave a reminder behind when they come back while it is still being scheduled', async () => {
    renderHook(() => useRunnerIdleReminder(true));

    // Back in the app before the native "replace" cancel has even returned.
    appStateListener?.('background');
    appStateListener?.('active');
    await flush();

    expect(schedule).not.toHaveBeenCalled();
  });

  it('takes the reminder back out when they return while it is being scheduled', async () => {
    let finishSchedule: (v: string) => void = () => {};
    schedule.mockImplementationOnce(() => new Promise<string>((r) => { finishSchedule = r; }));
    renderHook(() => useRunnerIdleReminder(true));

    appStateListener?.('background');
    await flush(); // the replace-cancel resolves; the schedule is now in flight
    expect(schedule).toHaveBeenCalledTimes(1);

    (AppState as any).currentState = 'active';
    appStateListener?.('active');
    cancel.mockClear();
    finishSchedule('id');
    await flush();

    expect(cancel).toHaveBeenCalledWith(IDLE_REMINDER_ID);
  });

  it('cancels it and stops listening when they go offline or start an errand', () => {
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useRunnerIdleReminder(active),
      { initialProps: { active: true } },
    );
    cancel.mockClear();

    rerender({ active: false });

    expect(remove).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(IDLE_REMINDER_ID);
  });

  it('never schedules for a runner who is offline or on an errand', async () => {
    renderHook(() => useRunnerIdleReminder(false));

    expect(appStateListener).toBeNull();
    await flush();
    expect(schedule).not.toHaveBeenCalled();
  });
});
