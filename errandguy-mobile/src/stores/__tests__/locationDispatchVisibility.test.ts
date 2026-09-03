/**
 * Dispatch visibility — the honest half of "ONLINE".
 *
 * MatchingService drops any runner whose `last_location_at` is older than five
 * minutes, and the app's GPS is a foreground-only watch (background location is
 * deliberately not implemented). These tests pin the two things that keep the
 * runner home screen from asserting "receiving requests" at a runner who is
 * invisible: the freshness predicates, and the one-shot ping behind the
 * "refresh" tap.
 */
import { act } from '@testing-library/react-native';
import {
  useLocationStore,
  isPingStale,
  isServerLocationStale,
  DISPATCH_WARN_AFTER_MS,
  DISPATCH_STALE_AFTER_MS,
} from '../locationStore';
import { useRunnerStore } from '../runnerStore';
import { runnerService } from '../../services/runner.service';
import { getCurrentCoords as getCurrentCoordsRaw } from '../../utils/locationPermission';

jest.mock('../../services/runner.service', () => ({
  runnerService: { updateLocation: jest.fn() },
}));

jest.mock('../../utils/locationPermission', () => ({
  getCurrentCoords: jest.fn(),
  ensureLocationPermission: jest.fn(() => Promise.resolve(true)),
}));

const updateLocation = runnerService.updateLocation as unknown as jest.Mock;
const getCurrentCoords = getCurrentCoordsRaw as unknown as jest.Mock;

beforeEach(() => {
  updateLocation.mockReset().mockResolvedValue({ data: {} });
  getCurrentCoords.mockReset().mockResolvedValue(null);
  useLocationStore.setState({
    currentLocation: null,
    isTracking: false,
    lastPingAt: null,
    isPinging: false,
  });
  useRunnerStore.setState({ currentErrand: null });
});

describe('isPingStale', () => {
  const now = 1_700_000_000_000;

  it('is not stale for a ping that just landed', () => {
    expect(isPingStale(now - 1_000, now)).toBe(false);
  });

  it('warns before the server actually drops the runner', () => {
    expect(DISPATCH_WARN_AFTER_MS).toBeLessThan(DISPATCH_STALE_AFTER_MS);
    expect(isPingStale(now - DISPATCH_WARN_AFTER_MS - 1, now)).toBe(true);
  });

  /**
   * "Nothing sent yet" is NOT a reason to cry wolf — going online seeds the
   * server position, so the caption must stay calm until we have evidence.
   */
  it('treats a session with no ping yet as unknown, not stale', () => {
    expect(isPingStale(null, now)).toBe(false);
  });
});

describe('isServerLocationStale', () => {
  const now = 1_700_000_000_000;

  it('uses the FULL server cutoff, so device clock skew cannot invent it', () => {
    // Past the warn threshold but inside the real cutoff → still silent.
    const inBetween = new Date(now - DISPATCH_WARN_AFTER_MS - 30_000).toISOString();
    expect(isServerLocationStale(inBetween, now)).toBe(false);
  });

  it('flags a runner the server has provably dropped', () => {
    const old = new Date(now - DISPATCH_STALE_AFTER_MS - 60_000).toISOString();
    expect(isServerLocationStale(old, now)).toBe(true);
  });

  it('says nothing when the field is absent or unparseable', () => {
    expect(isServerLocationStale(null, now)).toBe(false);
    expect(isServerLocationStale(undefined, now)).toBe(false);
    expect(isServerLocationStale('not-a-date', now)).toBe(false);
  });
});

describe('pingLocation', () => {
  it('stamps lastPingAt when the server takes the ping', async () => {
    useLocationStore.setState({ currentLocation: { lat: 14.5, lng: 120.9 } });

    let ok = false;
    await act(async () => {
      ok = await useLocationStore.getState().pingLocation();
    });

    expect(ok).toBe(true);
    expect(useLocationStore.getState().lastPingAt).not.toBeNull();
    expect(useLocationStore.getState().isPinging).toBe(false);
  });

  /**
   * 429 is the server's own 1-per-5s throttle: a FRESHER ping already landed,
   * so dispatch can see us. Counting it as a failure would flap the warning.
   */
  it('counts a throttled 429 as visible', async () => {
    useLocationStore.setState({ currentLocation: { lat: 14.5, lng: 120.9 } });
    updateLocation.mockRejectedValueOnce({ status: 429 });

    let ok = false;
    await act(async () => {
      ok = await useLocationStore.getState().pingLocation();
    });

    expect(ok).toBe(true);
    expect(useLocationStore.getState().lastPingAt).not.toBeNull();
  });

  it('reports failure and leaves lastPingAt alone on a real error', async () => {
    useLocationStore.setState({ currentLocation: { lat: 14.5, lng: 120.9 } });
    updateLocation.mockRejectedValueOnce({ status: 500 });

    let ok = true;
    await act(async () => {
      ok = await useLocationStore.getState().pingLocation();
    });

    expect(ok).toBe(false);
    expect(useLocationStore.getState().lastPingAt).toBeNull();
  });

  it('does nothing when we have never held a fix and cannot get one', async () => {
    let ok = true;
    await act(async () => {
      ok = await useLocationStore.getState().pingLocation({ fresh: true });
    });

    expect(ok).toBe(false);
    expect(updateLocation).not.toHaveBeenCalled();
  });

  /**
   * A re-POST of an OLD fix must never be tagged to a booking: the customer's
   * tracking screen renders the newest row and would present a stale position
   * with a fresh "updated just now".
   */
  it('never tags a re-posted stale fix with the active booking', async () => {
    useLocationStore.setState({ currentLocation: { lat: 14.5, lng: 120.9 } });
    useRunnerStore.setState({ currentErrand: { id: 'bk-1' } as never });

    await act(async () => {
      await useLocationStore.getState().pingLocation({ fresh: false });
    });

    expect(updateLocation).toHaveBeenCalledWith(
      expect.objectContaining({ booking_id: null }),
    );
  });

  /**
   * The foreground listener and the runner's own "refresh" tap can land in the
   * same moment; two overlapping pings would race the server's 1-per-5s
   * throttle and let the loser clear `isPinging` under the winner.
   */
  it('shares one in-flight ping between concurrent callers', async () => {
    useLocationStore.setState({ currentLocation: { lat: 14.5, lng: 120.9 } });

    await act(async () => {
      const a = useLocationStore.getState().pingLocation();
      const b = useLocationStore.getState().pingLocation();
      expect(await Promise.all([a, b])).toEqual([true, true]);
    });

    expect(updateLocation).toHaveBeenCalledTimes(1);
    expect(useLocationStore.getState().isPinging).toBe(false);
  });

  it('tags a genuinely new fix with the active booking', async () => {
    useRunnerStore.setState({ currentErrand: { id: 'bk-1' } as never });
    getCurrentCoords.mockResolvedValueOnce({ lat: 14.6, lng: 121.0 });

    await act(async () => {
      await useLocationStore.getState().pingLocation({ fresh: true });
    });

    expect(updateLocation).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 14.6, lng: 121.0, booking_id: 'bk-1' }),
    );
  });
});

describe('tracking lifecycle', () => {
  it('seeds freshness on arm and clears it when the shift ends', async () => {
    getCurrentCoords.mockResolvedValue({ lat: 14.6, lng: 121.0 });

    await act(async () => {
      await useLocationStore.getState().startTracking();
    });

    expect(useLocationStore.getState().isTracking).toBe(true);
    // Going online PUTs coords to /runner/online, which writes
    // last_location_at server-side — so the runner really is visible the
    // instant we arm, and the hero must not flash a warning.
    expect(useLocationStore.getState().lastPingAt).not.toBeNull();

    act(() => useLocationStore.getState().stopTracking());

    expect(useLocationStore.getState().isTracking).toBe(false);
    expect(useLocationStore.getState().lastPingAt).toBeNull();
  });
});
