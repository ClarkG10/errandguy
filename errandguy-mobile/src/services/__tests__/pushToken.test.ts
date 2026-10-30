jest.mock('expo-notifications', () => ({
  dismissAllNotificationsAsync: jest.fn(async () => {}),
  setBadgeCountAsync: jest.fn(async () => true),
  unregisterForNotificationsAsync: jest.fn(async () => {}),
}));

import * as Notifications from 'expo-notifications';
import { currentPushToken, rememberPushToken, unregisterPushLocally } from '../pushToken';

describe('letting go of push at sign-out', () => {
  beforeEach(() => jest.clearAllMocks());

  it('forgets the token, clears the tray + badge, and unregisters this install', async () => {
    rememberPushToken('ExponentPushToken[abc]');
    expect(currentPushToken()).toBe('ExponentPushToken[abc]');

    await unregisterPushLocally();

    expect(currentPushToken()).toBeNull();
    expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalled();
    expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(0);
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
  });

  it('never throws, even when the native module is missing or fails', async () => {
    (Notifications.dismissAllNotificationsAsync as jest.Mock).mockImplementation(() => {
      throw new Error('no native module');
    });
    (Notifications.unregisterForNotificationsAsync as jest.Mock).mockRejectedValue(new Error('fcm down'));
    await expect(unregisterPushLocally()).resolves.toBeUndefined();
  });

  it('does not hold sign-out hostage to a hung unregister', async () => {
    jest.useFakeTimers();
    (Notifications.unregisterForNotificationsAsync as jest.Mock).mockImplementation(() => new Promise(() => {}));
    const done = jest.fn();
    const p = unregisterPushLocally().then(done);
    await jest.advanceTimersByTimeAsync(3_100);
    await p;
    expect(done).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
