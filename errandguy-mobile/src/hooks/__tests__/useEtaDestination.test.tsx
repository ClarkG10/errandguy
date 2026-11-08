import { renderHook, act } from '@testing-library/react-native';
import { useEta } from '../useEta';

const mockGetRoute = jest.fn();
jest.mock('../../services/route.service', () => {
  const actual = jest.requireActual('../../services/route.service');
  return {
    ...actual,
    routeService: { getRoute: (...a: unknown[]) => mockGetRoute(...a) },
  };
});

/**
 * Two stops of one errand can sit inside the same ~110 m cell (two shops on a
 * street). The destination was keyed at 3 decimals, so moving on to the next
 * stop looked like the same destination: no new route, and the map kept the
 * previous leg's line.
 */
describe('useEta — the next stop', () => {
  beforeEach(() => {
    mockGetRoute.mockReset();
    mockGetRoute.mockResolvedValue({ coordinates: [[121, 14]], distanceMeters: 500, durationSeconds: 120 });
  });

  it('fetches a new route when the destination moves ~40 m, inside the same 3-decimal cell', async () => {
    const runner = { lat: 14.6011, lng: 121.0011 };
    const { rerender } = renderHook(
      ({ dest }: { dest: { lat: number; lng: number } }) => useEta(runner, dest),
      { initialProps: { dest: { lat: 14.55410, lng: 121.02410 } } },
    );
    await act(async () => {});
    expect(mockGetRoute).toHaveBeenCalledTimes(1);

    // Next stop: ~40 m away — same 14.554 / 121.024 cell.
    rerender({ dest: { lat: 14.55440, lng: 121.02440 } });
    await act(async () => {});

    expect(mockGetRoute).toHaveBeenCalledTimes(2);
    expect(mockGetRoute.mock.calls[1][1]).toEqual({ lat: 14.5544, lng: 121.0244 });
  });

  it('still ignores the runner’s own small movements', async () => {
    const dest = { lat: 14.5541, lng: 121.0241 };
    const { rerender } = renderHook(
      ({ origin }: { origin: { lat: number; lng: number } }) => useEta(origin, dest),
      { initialProps: { origin: { lat: 14.60112, lng: 121.00108 } } },
    );
    await act(async () => {});
    rerender({ origin: { lat: 14.60138, lng: 121.00131 } });
    await act(async () => {});

    expect(mockGetRoute).toHaveBeenCalledTimes(1);
  });
});
