import { useEchoChannel } from './useEchoChannel';
import { useLocationStore } from '../stores/locationStore';
import type { RunnerLocation } from '../types';

export function useRunnerTracking(bookingId: string | null) {
  // Per-field selectors: this hook feeds the heavy customer TrackingScreen, so a
  // whole-store useLocationStore() would re-render it on ANY location-store write
  // (e.g. the customer's own GPS slice), not just runner-pin updates.
  const runnerLocation = useLocationStore((s) => s.runnerLocation);
  const setRunnerLocation = useLocationStore((s) => s.setRunnerLocation);

  // Runner location rides the SAME `booking.<id>` channel as booking status
  // (different event). useEchoChannel ref-counts the channel, so the tracking
  // screen's two subscriptions (status + location) share one connection and
  // neither's teardown kills the other.
  //
  // The API broadcasts `runner.location` with lat/lng/heading/speed already
  // cast to numbers (Eloquent decimals would otherwise arrive as strings and
  // freeze the map pin). Nulls stay null. No DELETE event exists to guard now
  // that this is an explicit broadcast rather than a raw table subscription.
  const { isConnected } = useEchoChannel({
    channel: `booking.${bookingId}`,
    event: 'runner.location',
    enabled: !!bookingId,
    onEvent: (payload) => {
      const row = payload as RunnerLocation | null;
      if (row) setRunnerLocation(row);
    },
  });

  return {
    runnerLocation,
    isConnected,
  };
}
