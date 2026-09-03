/**
 * GPS duty cycle — the runner's battery.
 *
 * The watch used to be armed at navigation grade (highest accuracy, a fix every
 * 6 seconds) for the ENTIRE time a runner was Online. But a runner is online for
 * hours waiting for offers, and during those hours the precision buys nothing:
 * no customer is watching a pin, and the only consumer is MatchingService's
 * radius query, which cannot tell 10 m from 150 m. All it cost was battery — the
 * thing a gig worker feels most, and the reason they start declining jobs to
 * make it to the end of a shift.
 *
 * These pin the trade: coarse and cheap while idle, unchanged while an errand is
 * in hand, and — the trap in this change — an accuracy GATE that moves with the
 * profile. Accuracy.Balanced returns roughly 100 m fixes, so keeping the active
 * profile's 75 m filter would have silently discarded almost every idle fix and
 * left the runner ageing out of matching entirely.
 */
import { act } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useLocationStore } from '../locationStore';
import { useRunnerStore } from '../runnerStore';
import { runnerService } from '../../services/runner.service';

jest.mock('../../services/runner.service', () => ({
  runnerService: { updateLocation: jest.fn() },
}));

jest.mock('../../utils/locationPermission', () => ({
  getCurrentCoords: jest.fn(() => Promise.resolve(null)),
  ensureLocationPermission: jest.fn(() => Promise.resolve(true)),
}));

const watchPositionAsync = Location.watchPositionAsync as unknown as jest.Mock;
const updateLocation = runnerService.updateLocation as unknown as jest.Mock;

/** The options the most recent arm passed to expo-location. */
const armedOptions = () => watchPositionAsync.mock.calls.at(-1)?.[0];
/** The position callback the most recent arm registered. */
const armedCallback = () => watchPositionAsync.mock.calls.at(-1)?.[1];

const fixWithAccuracy = (accuracy: number, lat = 14.6, lng = 121.0) => ({
  coords: { latitude: lat, longitude: lng, accuracy, heading: -1, speed: -1 },
});

beforeEach(() => {
  watchPositionAsync.mockClear();
  watchPositionAsync.mockImplementation(() => Promise.resolve({ remove: jest.fn() }));
  updateLocation.mockReset().mockResolvedValue({ data: {} });
  useRunnerStore.setState({ currentErrand: null });
  useLocationStore.setState({
    currentLocation: null,
    isTracking: false,
    lastPingAt: null,
    isPinging: false,
    watchId: null,
  });
});

afterEach(() => {
  act(() => useLocationStore.getState().stopTracking());
});

describe('profile selection', () => {
  it('arms the CHEAP profile for a runner who is online but idle', async () => {
    await act(async () => {
      await useLocationStore.getState().startTracking();
    });

    const opts = armedOptions();
    expect(opts.accuracy).toBe(Location.Accuracy.Balanced);
    // Coarse enough to matter for battery; matching works in kilometres.
    expect(opts.distanceInterval).toBeGreaterThanOrEqual(100);
    expect(opts.timeInterval).toBeGreaterThanOrEqual(30_000);
  });

  it('arms the NAVIGATION profile when an errand is in hand', async () => {
    useRunnerStore.setState({ currentErrand: { id: 'bk-1' } as never });

    await act(async () => {
      await useLocationStore.getState().startTracking();
    });

    const opts = armedOptions();
    // Unchanged from the original: a customer is watching this pin, and the
    // ETA and "runner is nearby" alert depend on it.
    expect(opts.accuracy).toBe(Location.Accuracy.High);
    expect(opts.distanceInterval).toBe(10);
    // 6000ms, not 5000ms: the server throttles /runner/location to 1/5s and
    // arming at exactly the throttle produces sporadic 429s.
    expect(opts.timeInterval).toBe(6000);
  });
});

describe('the accuracy gate moves with the profile', () => {
  it('keeps a ~100m fix while idle (a 75m gate would drop nearly all of them)', async () => {
    await act(async () => {
      await useLocationStore.getState().startTracking();
    });

    await act(async () => {
      armedCallback()(fixWithAccuracy(110));
    });

    expect(updateLocation).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 14.6, lng: 121.0 }),
    );
  });

  it('still drops a genuinely useless fix while idle', async () => {
    await act(async () => {
      await useLocationStore.getState().startTracking();
    });

    await act(async () => {
      armedCallback()(fixWithAccuracy(5000));
    });

    expect(updateLocation).not.toHaveBeenCalled();
  });

  it('keeps the tight gate during an errand, so the pin cannot teleport', async () => {
    useRunnerStore.setState({ currentErrand: { id: 'bk-1' } as never });

    await act(async () => {
      await useLocationStore.getState().startTracking();
    });

    await act(async () => {
      armedCallback()(fixWithAccuracy(110));
    });

    expect(updateLocation).not.toHaveBeenCalled();
  });
});

describe('swapping profiles mid-shift', () => {
  it('upgrades the moment the runner takes an errand', async () => {
    await act(async () => {
      await useLocationStore.getState().startTracking();
    });
    expect(armedOptions().accuracy).toBe(Location.Accuracy.Balanced);

    // Driven off the errand, not a screen mount — so this happens even when a
    // runner accepts from a notification and never opens the cockpit.
    await act(async () => {
      useRunnerStore.setState({ currentErrand: { id: 'bk-1' } as never });
    });

    expect(armedOptions().accuracy).toBe(Location.Accuracy.High);
  });

  it('downgrades again when the errand is finished', async () => {
    useRunnerStore.setState({ currentErrand: { id: 'bk-1' } as never });
    await act(async () => {
      await useLocationStore.getState().startTracking();
    });
    expect(armedOptions().accuracy).toBe(Location.Accuracy.High);

    await act(async () => {
      useRunnerStore.setState({ currentErrand: null });
    });

    // Otherwise a runner who closed the app on the completion screen keeps
    // burning navigation-grade GPS with no errand in hand.
    expect(armedOptions().accuracy).toBe(Location.Accuracy.Balanced);
  });

  it('does not re-arm when the errand merely changes status', async () => {
    useRunnerStore.setState({ currentErrand: { id: 'bk-1', status: 'accepted' } as never });
    await act(async () => {
      await useLocationStore.getState().startTracking();
    });
    const armsAfterStart = watchPositionAsync.mock.calls.length;

    await act(async () => {
      useRunnerStore.setState({ currentErrand: { id: 'bk-1', status: 'picked_up' } as never });
    });

    // A status tick fires several times per errand; re-arming the GPS watch on
    // each would drop fixes for no reason.
    expect(watchPositionAsync.mock.calls.length).toBe(armsAfterStart);
  });

  /**
   * The cockpit and turn-by-turn screens both re-arm on `!isTracking`. If a
   * profile swap flipped that flag off even momentarily, those effects would
   * fire a CONCURRENT startTracking and leak a second watch, double-sending
   * GPS and double-charging the rate limit.
   */
  it('never reports itself as untracked while swapping profiles', async () => {
    await act(async () => {
      await useLocationStore.getState().startTracking();
    });

    const seen: boolean[] = [];
    const unsub = useLocationStore.subscribe((s) => seen.push(s.isTracking));

    await act(async () => {
      useRunnerStore.setState({ currentErrand: { id: 'bk-1' } as never });
    });
    unsub();

    expect(seen).not.toContain(false);
    expect(useLocationStore.getState().isTracking).toBe(true);
  });

  it('stops swapping once the shift ends', async () => {
    await act(async () => {
      await useLocationStore.getState().startTracking();
    });
    act(() => useLocationStore.getState().stopTracking());
    const armsAfterStop = watchPositionAsync.mock.calls.length;

    await act(async () => {
      useRunnerStore.setState({ currentErrand: { id: 'bk-1' } as never });
    });

    // The errand watcher must be torn down with the rest of the rig — an
    // offline runner's GPS must stay off.
    expect(watchPositionAsync.mock.calls.length).toBe(armsAfterStop);
    expect(useLocationStore.getState().isTracking).toBe(false);
  });
});
