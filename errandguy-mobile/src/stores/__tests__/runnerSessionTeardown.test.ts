/**
 * Leaving runner mode turns the GPS off.
 *
 * Signing out, a session the server ended, another account signing in and
 * switching to customer mode all used to leave the location watch and the
 * once-a-minute heartbeat running: the phone kept posting the runner's position
 * with a token that was revoked or gone — every ping a 401/403 that re-ran the
 * session teardown — and a runner who switched to customer mode carried a live
 * GPS fix around all day.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { act } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useLocationStore } from '../locationStore';
import { useRunnerStore } from '../runnerStore';
import { runnerService } from '../../services/runner.service';
import { stopRunnerActivity } from '../../utils/runnerSession';
import { clearAccountScopedState } from '../../utils/clearAccountScopedState';
import { makeBooking } from '../../__mocks__/factories';

jest.mock('../../services/runner.service', () => ({
  runnerService: { updateLocation: jest.fn() },
}));

jest.mock('../../utils/locationPermission', () => ({
  getCurrentCoords: jest.fn(() => Promise.resolve(null)),
  ensureLocationPermission: jest.fn(() => Promise.resolve(true)),
}));

const watchPositionAsync = Location.watchPositionAsync as unknown as jest.Mock;
const updateLocation = runnerService.updateLocation as unknown as jest.Mock;
let removeWatch: jest.Mock;

const goOnlineWithErrand = async () => {
  useRunnerStore.setState({
    isOnline: true,
    currentErrand: makeBooking({ id: 'bk-1', status: 'accepted' }),
    incomingRequest: { booking: makeBooking({ id: 'bk-2', status: 'matched' }), expiresAt: 1 },
    declinedOfferIds: ['bk-9'],
    earnings: { today: 120, week: 800, month: 2000, total: 9000 },
  });
  await act(async () => {
    await useLocationStore.getState().startTracking();
  });
  expect(useLocationStore.getState().isTracking).toBe(true);
};

beforeEach(() => {
  jest.useFakeTimers();
  removeWatch = jest.fn();
  watchPositionAsync.mockReset();
  watchPositionAsync.mockImplementation(() => Promise.resolve({ remove: removeWatch }));
  updateLocation.mockReset().mockResolvedValue({ data: {} });
  useRunnerStore.getState().reset();
  useLocationStore.setState({ isTracking: false, watchId: null, lastPingAt: null, isPinging: false });
});

afterEach(() => {
  act(() => useLocationStore.getState().stopTracking());
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('stopRunnerActivity', () => {
  it('stops the watch and the heartbeat, and resets the runner to signed-out', async () => {
    await goOnlineWithErrand();

    act(() => stopRunnerActivity());

    expect(removeWatch).toHaveBeenCalled();
    expect(useLocationStore.getState()).toMatchObject({ isTracking: false, watchId: null });
    expect(useRunnerStore.getState()).toMatchObject({
      isOnline: false,
      currentErrand: null,
      incomingRequest: null,
      runnerProfile: null,
      declinedOfferIds: [],
      earnings: { today: 0, week: 0, month: 0, total: 0 },
    });

    // Nothing posts afterwards — not the idle heartbeat, not a re-arm.
    updateLocation.mockClear();
    watchPositionAsync.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(5 * 60_000);
    });
    expect(updateLocation).not.toHaveBeenCalled();
    expect(watchPositionAsync).not.toHaveBeenCalled();
  });

  it('stops tracking BEFORE clearing the errand, so the duty-cycle watcher cannot re-arm the GPS', async () => {
    await goOnlineWithErrand();
    watchPositionAsync.mockClear();

    act(() => stopRunnerActivity());
    await act(async () => {
      await Promise.resolve();
    });

    // Clearing currentErrand while tracking was live would have swapped the
    // profile — i.e. started a fresh watch.
    expect(watchPositionAsync).not.toHaveBeenCalled();
    expect(useLocationStore.getState().isTracking).toBe(false);
  });

  it('is safe to call when nothing is running', () => {
    expect(() => stopRunnerActivity()).not.toThrow();
    expect(() => stopRunnerActivity()).not.toThrow();
  });
});

describe('every way out of runner mode runs it', () => {
  it('the account wipe (sign-out, another account signing in, a dead account)', async () => {
    await goOnlineWithErrand();

    await act(async () => {
      await clearAccountScopedState();
    });

    expect(useLocationStore.getState().isTracking).toBe(false);
    expect(useRunnerStore.getState().isOnline).toBe(false);
    expect(useRunnerStore.getState().currentErrand).toBeNull();
  });

  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');

  it('a session the server ended (401 / dead-account 403) stops it before anything awaits', () => {
    const API = read('services', 'api.ts');
    const endSession = API.slice(API.indexOf('async function endSession('));
    const stop = endSession.indexOf("require('../utils/runnerSession')");
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(endSession.indexOf("await secureStorage.remove('auth_token')"));
  });

  it('switching to customer mode stops it once the role has flipped', () => {
    const PROFILE = read('app', '(runner)', '(tabs)', 'profile.tsx');
    const sw = PROFILE.slice(
      PROFILE.indexOf('const confirmSwitchToCustomer'),
      PROFILE.indexOf("router.replace('/(customer)/(tabs)'"),
    );
    // Going offline turns the GPS off, as the Home toggle does…
    expect(sw).toMatch(/setOnlineLocal\(false\);\s*\/\/[^\n]*\n\s*useLocationStore\.getState\(\)\.stopTracking\(\)/);
    // …and leaving runner mode clears the rest.
    expect(sw.indexOf('stopRunnerActivity()')).toBeGreaterThan(sw.indexOf('setUser(fresh)'));
  });
});
