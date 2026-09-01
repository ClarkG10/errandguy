import React from 'react';
import { Switch } from 'react-native';
import { Linking } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import NotificationsScreen from '../notifications';
import { useAuthStore } from '../../../../stores/authStore';
import { storage } from '../../../../utils/storage';
import type { User } from '../../../../types';

// The screen reads the LIVE OS permission — that is the only real control it
// offers, so it is what these tests pin.
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
}));

const mockGetPermissions = Notifications.getPermissionsAsync as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPermissions.mockResolvedValue({ granted: true, status: 'granted' });
  useAuthStore.setState({ user: { id: 'runner-1', role: 'runner' } as unknown as User });
});

describe('runner notification settings are honest', () => {
  it('ships no per-category switches — the old ones persisted to AsyncStorage and nothing read them', async () => {
    const { UNSAFE_queryAllByType, getByText } = render(<NotificationsScreen />);
    await waitFor(() => getByText('Notifications are on for ErrandGuy.'));

    // A Switch on this screen is by definition a lie until the server grows a
    // notification-preference column AND NotificationService consults it.
    expect(UNSAFE_queryAllByType(Switch)).toHaveLength(0);
  });

  it('still tells the runner what the app sends, including the never-muted safety row', async () => {
    const { getByText, findByText } = render(<NotificationsScreen />);
    await findByText('Notifications are on for ErrandGuy.');

    expect(getByText('New Errand Requests')).toBeTruthy();
    expect(getByText('Chat Messages')).toBeTruthy();
    expect(getByText('Reviews & Ratings')).toBeTruthy();
    expect(getByText('Safety Alerts')).toBeTruthy();
    expect(getByText('Always on for your safety')).toBeTruthy();
  });

  it('routes to the OS settings — the one switch that actually works today', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const { findByText, getByText } = render(<NotificationsScreen />);
    await findByText('Notifications are on for ErrandGuy.');

    fireEvent.press(getByText('Open Device Settings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });

  it('warns, and offers to fix it, when the OS permission is denied', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, status: 'denied' });
    const { findByText } = render(<NotificationsScreen />);

    expect(
      await findByText(/Notifications are off\./),
    ).toBeTruthy();
    expect(await findByText('Turn On Notifications')).toBeTruthy();
  });

  it('degrades to a neutral line when the permission cannot be read', async () => {
    mockGetPermissions.mockRejectedValue(new Error('unavailable'));
    const { findByText } = render(<NotificationsScreen />);

    expect(await findByText('Checking your device settings…')).toBeTruthy();
  });

  it('clears the orphaned runner_notif_prefs key the removed toggles wrote', async () => {
    const remove = jest.spyOn(storage, 'remove').mockResolvedValue(undefined);
    render(<NotificationsScreen />);

    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith('runner_notif_prefs:runner-1'),
    );
    remove.mockRestore();
  });
});
