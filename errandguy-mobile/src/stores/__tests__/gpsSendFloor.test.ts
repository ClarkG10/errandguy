/**
 * The GPS sender's floor and in-flight guard.
 *
 * `timeInterval` on the watch is Android-only. On iOS a driving runner gets a
 * fix about every second, and the server keeps only one ping per 5s per runner
 * (429 for the rest) — so most iOS sends were wasted requests. These pin the
 * fix: at most one send per MIN_SEND_INTERVAL_MS, never two overlapping, and
 * the newest throttled fix still goes out once the floor passes (dropping it
 * would park the customer's pin short of where the runner stopped).
 */
import { act } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useLocationStore, MIN_SEND_INTERVAL_MS } from '../locationStore';
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
const armedCallback = () => watchPositionAsync.mock.calls.at(-1)?.[1];

/** A fix `metresNorth` north of a fixed point — far enough apart to pass the
 *  8 m jitter filter between consecutive calls. */
const fixAt = (metresNorth: number, accuracy = 12) => ({
  coords: {
    latitude: 14.6 + metresNorth / 111_000,
    longitude: 121.0,
    accuracy,
    heading: -1,
    speed: -1,
  },
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const goOnlineOnErrand = async () => {
  useRunnerStore.setState({ currentErrand: { id: 'bk-1' } as never });
  await act(async () => {
    await useLocationStore.getState().startTracking();
  });
};

beforeEach(() => {
  jest.useFakeTimers();
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
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('sends the first fix at once, with its accuracy and the active booking', async () => {
  await goOnlineOnErrand();

  act(() => armedCallback()(fixAt(0, 12)));

  expect(updateLocation).toHaveBeenCalledTimes(1);
  expect(updateLocation).toHaveBeenCalledWith(
    expect.objectContaining({ accuracy: 12, booking_id: 'bk-1' }),
  );
});

it('holds a fix that arrives inside the floor, then sends the NEWEST one', async () => {
  await goOnlineOnErrand();

  act(() => armedCallback()(fixAt(0)));
  await flush();
  // iOS at driving speed: a fix a second.
  act(() => {
    jest.advanceTimersByTime(1_000);
    armedCallback()(fixAt(20));
  });
  act(() => {
    jest.advanceTimersByTime(1_000);
    armedCallback()(fixAt(40));
  });

  expect(updateLocation).toHaveBeenCalledTimes(1);

  // The UI still moves on every fix — only the network send is floored.
  expect(useLocationStore.getState().currentLocation?.lat).toBeCloseTo(14.6 + 40 / 111_000, 6);

  await act(async () => {
    jest.advanceTimersByTime(MIN_SEND_INTERVAL_MS);
  });

  expect(updateLocation).toHaveBeenCalledTimes(2);
  expect(updateLocation.mock.calls[1][0].lat).toBeCloseTo(14.6 + 40 / 111_000, 6);
});

it('never overlaps two sends, even past the floor', async () => {
  let release: () => void = () => {};
  updateLocation.mockImplementationOnce(
    () => new Promise((resolve) => {
      release = () => resolve({ data: {} });
    }),
  );
  await goOnlineOnErrand();

  act(() => armedCallback()(fixAt(0)));
  // A dead-zone request still hanging well past the floor.
  act(() => {
    jest.advanceTimersByTime(MIN_SEND_INTERVAL_MS + 2_000);
    armedCallback()(fixAt(30));
  });
  expect(updateLocation).toHaveBeenCalledTimes(1);

  await act(async () => {
    release();
    await Promise.resolve();
  });
  await flush();

  expect(updateLocation).toHaveBeenCalledTimes(2);
  expect(updateLocation.mock.calls[1][0].lat).toBeCloseTo(14.6 + 30 / 111_000, 6);
});

it('drops a held fix when the shift ends', async () => {
  await goOnlineOnErrand();

  act(() => armedCallback()(fixAt(0)));
  await flush();
  act(() => {
    jest.advanceTimersByTime(1_000);
    armedCallback()(fixAt(25));
  });
  act(() => useLocationStore.getState().stopTracking());

  await act(async () => {
    jest.advanceTimersByTime(MIN_SEND_INTERVAL_MS * 2);
  });

  expect(updateLocation).toHaveBeenCalledTimes(1);
});

it('still sends a stationary heartbeat fix once the floor allows', async () => {
  await goOnlineOnErrand();

  act(() => armedCallback()(fixAt(0)));
  await flush();
  // Not moved, but 30s on: the watch's own heartbeat rule lets it through.
  act(() => {
    jest.advanceTimersByTime(30_500);
    armedCallback()(fixAt(1));
  });

  expect(updateLocation).toHaveBeenCalledTimes(2);
});

it('drops a held fix when the app goes to the background, so it never lands late', async () => {
  const { AppState } = jest.requireActual('react-native') as typeof import('react-native');
  const listeners: Array<(s: string) => void> = [];
  const spy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, cb) => {
      listeners.push(cb as (s: string) => void);
      return { remove: jest.fn() } as never;
    });
  try {
    await goOnlineOnErrand();
    act(() => armedCallback()(fixAt(0)));
    await flush();
    act(() => {
      jest.advanceTimersByTime(1_000);
      armedCallback()(fixAt(30)); // held
    });

    // Off to Waze: the held fix must not go out on return as "just now".
    expect(listeners.length).toBeGreaterThan(0);
    act(() => listeners.forEach((l) => l('background')));
    await act(async () => {
      jest.advanceTimersByTime(MIN_SEND_INTERVAL_MS * 3);
    });

    expect(updateLocation).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

it('keeps the last fix for the next slot when the server throttled it', async () => {
  await goOnlineOnErrand();
  updateLocation.mockRejectedValueOnce({ status: 429 });

  // The runner's final position at the door, refused by the 5s throttle.
  act(() => armedCallback()(fixAt(0)));
  await flush();
  expect(updateLocation).toHaveBeenCalledTimes(1);

  // A still phone sends no more fixes; the refused one goes out again.
  await act(async () => {
    jest.advanceTimersByTime(MIN_SEND_INTERVAL_MS);
  });
  expect(updateLocation).toHaveBeenCalledTimes(2);
  expect(updateLocation.mock.calls[1][0].lat).toBeCloseTo(14.6, 6);
});
