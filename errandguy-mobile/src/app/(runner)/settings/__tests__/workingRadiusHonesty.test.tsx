import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import WorkingAreasScreen from '../working-areas';
import { useRunnerStore } from '../../../../stores/runnerStore';
import { useLocationStore } from '../../../../stores/locationStore';
import { runnerService } from '../../../../services/runner.service';
import type { RunnerProfile } from '../../../../types';

// jest.setup's expo-router mock has no useNavigation; the screen registers a
// beforeRemove listener for the unsaved-edit guard.
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()) }),
}));

// jest.setup's expo-location mock omits the two calls the screen's SILENT
// seed uses, and the whole point of that seed is that it must never prompt.
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(() => Promise.resolve(null)),
  Accuracy: { High: 'high', Balanced: 'balanced' },
}));

jest.mock('../../../../services/runner.service', () => ({
  runnerService: {
    updateRunnerProfile: jest.fn(() => Promise.resolve({ data: { data: {} } })),
    getRunnerProfile: jest.fn(() => Promise.resolve({ data: { data: {} } })),
  },
}));

const mockUpdate = runnerService.updateRunnerProfile as jest.Mock;
const mockGetPerms = Location.getForegroundPermissionsAsync as unknown as jest.Mock;
const mockRequestPerms = Location.requestForegroundPermissionsAsync as unknown as jest.Mock;
const mockGetPosition = Location.getCurrentPositionAsync as unknown as jest.Mock;

/**
 * A runner whose profile still carries a working-area centre pinned in
 * Makati (they are LEGACY values — the screen used to write them and the
 * server never read them) while their phone is currently in Cebu.
 */
const STALE_CENTRE_PROFILE = {
  id: 'rp1',
  user_id: 'r1',
  // Decimal columns arrive as strings from the API.
  working_area_lat: '14.5547000',
  working_area_lng: '121.0244000',
  working_area_radius: 5000,
} as unknown as RunnerProfile;

const CEBU = { lat: 10.3157, lng: 123.8854 };

const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <WorkingAreasScreen />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  useRunnerStore.setState({ runnerProfile: STALE_CENTRE_PROFILE });
  useLocationStore.setState({ currentLocation: CEBU } as never);
  mockGetPerms.mockResolvedValue({ status: 'denied', canAskAgain: true });
  mockGetPosition.mockResolvedValue({ coords: { latitude: CEBU.lat, longitude: CEBU.lng, accuracy: 5 } });
});

describe('working radius matches what the server actually filters on', () => {
  it('shows the runner where the circle is really measured from — their live fix, not the stale saved pin', () => {
    const { getByText, queryByText } = renderScreen();

    // Live position, not the Makati centre sitting on the profile.
    expect(getByText('10.3157, 123.8854')).toBeTruthy();
    expect(queryByText('14.5547, 121.0244')).toBeNull();
    expect(getByText('Measured from your current location')).toBeTruthy();
  });

  it('saves the radius ALONE — a stored centre nothing reads is no longer written', async () => {
    const { UNSAFE_getByType, getByText } = renderScreen();

    fireEvent(UNSAFE_getByType(Slider), 'slidingComplete', 12000);
    fireEvent.press(getByText('Save Working Radius'));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith({ working_area_radius: 12000 });
    // The two fields with zero server consumers must not be in the payload —
    // writing them would hand a future consumer a stale accidental centre.
    const payload = mockUpdate.mock.calls[0][0];
    expect(payload).not.toHaveProperty('working_area_lat');
    expect(payload).not.toHaveProperty('working_area_lng');
  });

  it('is savable with location off — the radius is a plain number, not a place', async () => {
    useLocationStore.setState({ currentLocation: null } as never);
    const { UNSAFE_getByType, getByText, findByText } = renderScreen();

    // Silent seed resolves to nothing (permission not granted) → the CTA state.
    await findByText('Location not available');
    expect(mockRequestPerms).not.toHaveBeenCalled();
    fireEvent(UNSAFE_getByType(Slider), 'slidingComplete', 3000);
    fireEvent.press(getByText('Save Working Radius'));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ working_area_radius: 3000 }));
  });

  it('still gates a no-op save', () => {
    const { getByText } = renderScreen();
    fireEvent.press(getByText('Save Working Radius'));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('discloses that direct offers can arrive from outside this radius', () => {
    const { getByText } = renderScreen();
    expect(
      getByText(/offered to you directly can still come from a little further out/),
    ).toBeTruthy();
  });

  it('seeds the map from an already-granted permission WITHOUT prompting', async () => {
    // locationStore is only ever written by this screen, so a returning
    // runner opens it with an empty store; the map must not fall back to an
    // "Enable Location" wall for someone who granted location months ago.
    useLocationStore.setState({ currentLocation: null } as never);
    mockGetPerms.mockResolvedValue({ status: 'granted', canAskAgain: false });
    mockGetPosition.mockResolvedValue({
      coords: { latitude: 10.3157, longitude: 123.8854, accuracy: 5 },
    });

    const { findByText } = renderScreen();

    expect(await findByText('10.3157, 123.8854')).toBeTruthy();
    // Opening a settings screen must never raise an OS permission dialog.
    expect(mockRequestPerms).not.toHaveBeenCalled();
    await act(async () => {});
  });
});
