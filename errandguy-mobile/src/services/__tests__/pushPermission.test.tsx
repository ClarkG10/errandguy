import fs from 'fs';
import path from 'path';
import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { toPushPermission, turnOnPush, readPushPermission } from '../pushPermission';
import { useNotificationStore } from '../../stores/notificationStore';
import { NotificationPrimer } from '../../components/settings/NotificationPrimer';

/**
 * Customers used to get the OS notification prompt cold, the moment Home first
 * rendered — and it's a one-shot. Now the app asks first (NotificationPrimer):
 * "Not now" spends nothing, only "Allow" shows the OS prompt, and Profile →
 * Notifications says whether push is on with a way to turn it on.
 */

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));

const mockGet = Notifications.getPermissionsAsync as jest.Mock;
const mockRequest = Notifications.requestPermissionsAsync as jest.Mock;
const UNASKED = { status: 'undetermined', granted: false, canAskAgain: true };
const BLOCKED = { status: 'denied', granted: false, canAskAgain: false };
const GRANTED = { status: 'granted', granted: true, canAskAgain: true };

let openSettings: jest.SpyInstance;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  useNotificationStore.setState({ pushPermission: null });
  openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as never);
});

describe('toPushPermission', () => {
  it('maps the OS answer onto what the app can do about it', () => {
    expect(toPushPermission(GRANTED)).toBe('granted');
    expect(toPushPermission(UNASKED)).toBe('undetermined');
    // Android 13 after one "Don't allow": still one prompt left.
    expect(toPushPermission({ status: 'denied', granted: false, canAskAgain: true })).toBe(
      'undetermined',
    );
    expect(toPushPermission(BLOCKED)).toBe('denied');
    expect(toPushPermission(null)).toBeNull();
  });
});

describe('turnOnPush', () => {
  it('asks the OS while it still can', async () => {
    mockGet.mockResolvedValue(UNASKED);
    mockRequest.mockResolvedValue(GRANTED);

    await expect(turnOnPush()).resolves.toBe('granted');

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(openSettings).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().pushPermission).toBe('granted');
  });

  it('opens the phone’s Settings once the prompt is used up', async () => {
    mockGet.mockResolvedValue(BLOCKED);

    await turnOnPush();

    expect(mockRequest).not.toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('does nothing when push is already on', async () => {
    mockGet.mockResolvedValue(GRANTED);

    await turnOnPush();

    expect(mockRequest).not.toHaveBeenCalled();
    expect(openSettings).not.toHaveBeenCalled();
  });

  it('reading never prompts', async () => {
    mockGet.mockResolvedValue(UNASKED);
    await readPushPermission();
    expect(mockRequest).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().pushPermission).toBe('undetermined');
  });
});

describe('NotificationPrimer', () => {
  const TITLE = 'Get updates about your errands?';

  it('explains first, and "Not now" does not spend the OS prompt', async () => {
    useNotificationStore.setState({ pushPermission: 'undetermined' });
    const screen = render(<NotificationPrimer enabled />);

    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText('Not now'));
    });

    expect(mockRequest).not.toHaveBeenCalled();
    expect(screen.queryByText(TITLE)).toBeNull();
    // …and it stays quiet for a while rather than asking on every launch.
    expect(Number(await AsyncStorage.getItem('@push_primer_snoozed_until'))).toBeGreaterThan(
      Date.now(),
    );
  });

  it('"Allow" shows the OS prompt', async () => {
    useNotificationStore.setState({ pushPermission: 'undetermined' });
    mockGet.mockResolvedValue(UNASKED);
    mockRequest.mockResolvedValue(GRANTED);
    const screen = render(<NotificationPrimer enabled />);

    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText('Allow'));
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useNotificationStore.getState().pushPermission).toBe('granted'));
  });

  it('stays hidden when push is on, blocked, or it was snoozed', async () => {
    useNotificationStore.setState({ pushPermission: 'granted' });
    const on = render(<NotificationPrimer enabled />);
    await act(async () => {});
    expect(on.queryByText(TITLE)).toBeNull();
    on.unmount();

    useNotificationStore.setState({ pushPermission: 'denied' });
    const blocked = render(<NotificationPrimer enabled />);
    await act(async () => {});
    expect(blocked.queryByText(TITLE)).toBeNull();
    blocked.unmount();

    await AsyncStorage.setItem('@push_primer_snoozed_until', String(Date.now() + 60_000));
    useNotificationStore.setState({ pushPermission: 'undetermined' });
    const snoozed = render(<NotificationPrimer enabled />);
    await act(async () => {});
    expect(snoozed.queryByText(TITLE)).toBeNull();
  });
});

describe('wiring', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

  it('the root layout asks customers through the primer, never cold', () => {
    const root = read('app/_layout.tsx');
    expect(root).toMatch(/useNotifications\(canRegisterPush, \{\s*askOs: role === 'runner',/);
    expect(root).toContain("<NotificationPrimer enabled={canRegisterPush && role === 'customer'} />");
  });

  it('registration records an unasked customer instead of prompting', () => {
    const hook = read('hooks/useNotifications.ts');
    const branch = hook.slice(hook.indexOf('if (!askOs) {')).slice(0, 200);
    expect(branch).toContain('setPushPermission(toPushPermission(existing))');
    expect(branch).toContain('return null;');
  });

  it('the customer Profile shows on/off with a way to turn it on', () => {
    const profile = read('app/(customer)/(tabs)/profile.tsx');
    expect(profile).toContain("label: 'Notifications'");
    expect(profile).toContain('void turnOnPush();');
    expect(profile).toContain('void readPushPermission();');
  });
});
