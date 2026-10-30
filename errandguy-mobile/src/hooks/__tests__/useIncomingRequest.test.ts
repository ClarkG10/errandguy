import { renderHook } from '@testing-library/react-native';
import { useIncomingRequest } from '../useIncomingRequest';
import { useRunnerStore } from '../../stores/runnerStore';
import type { Booking } from '../../types';

/**
 * Captures each useEchoChannel subscription so a test can fire the server
 * event by name, without standing up a websocket.
 */
const subscriptions: Array<{
  channel: string;
  event: string;
  enabled?: boolean;
  onEvent: (payload: unknown) => void;
}> = [];

jest.mock('../useEchoChannel', () => ({
  useEchoChannel: (opts: {
    channel: string;
    event: string;
    enabled?: boolean;
    onEvent: (payload: unknown) => void;
  }) => {
    subscriptions.push(opts);
    return { isConnected: true };
  },
}));

const fire = (event: string, payload: unknown) => {
  subscriptions.filter((s) => s.event === event).forEach((s) => s.onEvent(payload));
};

const offer = (id: string) =>
  ({ id, status: 'matched', booking_number: `EG-${id}` }) as unknown as Booking;

describe('useIncomingRequest', () => {
  beforeEach(() => {
    subscriptions.length = 0;
    useRunnerStore.setState({ incomingRequest: null, declinedOfferIds: [] });
  });

  it('subscribes to the runner’s direct-offer stream only', () => {
    renderHook(() => useIncomingRequest('runner-1'));

    expect(subscriptions).toEqual([
      expect.objectContaining({ channel: 'runner.runner-1', event: 'booking.incoming' }),
    ]);
  });

  it('opens the offer modal on an incoming matched booking', () => {
    const onOffer = jest.fn();
    renderHook(() => useIncomingRequest('runner-1', { onOffer }));

    fire('booking.incoming', offer('b1'));

    expect(useRunnerStore.getState().incomingRequest?.booking.id).toBe('b1');
    // Handed on so the layout can upgrade the thin realtime payload.
    expect(onOffer).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }));
  });

  /**
   * "Name your price" offers were fanned out to every nearby runner as an
   * unassigned (`pending`) booking. That broadcast is gone: an offer is always
   * matched to THIS runner, so anything else on the channel raises nothing.
   */
  it('ignores anything that is not a booking matched to this runner', () => {
    const onOffer = jest.fn();
    renderHook(() => useIncomingRequest('runner-1', { onOffer }));

    fire('booking.incoming', { id: 'b9', status: 'pending', pricing_mode: 'negotiate' });
    fire('booking.incoming', { status: 'matched' });

    expect(useRunnerStore.getState().incomingRequest).toBeNull();
    expect(onOffer).not.toHaveBeenCalled();
  });

  /**
   * A decline is fire-and-forget, so the booking can still be `matched` on the
   * server for a moment and be re-sent. Asking again reads as the app
   * ignoring the runner's answer.
   */
  it('never re-raises an offer the runner already declined', () => {
    const onOffer = jest.fn();
    renderHook(() => useIncomingRequest('runner-1', { onOffer }));

    fire('booking.incoming', offer('b1'));
    useRunnerStore.getState().declineErrand('b1');
    fire('booking.incoming', offer('b1'));

    expect(useRunnerStore.getState().incomingRequest).toBeNull();
    // Only the first, genuinely raised offer is handed on.
    expect(onOffer).toHaveBeenCalledTimes(1);
  });

  it('subscribes to nothing without a runner id', () => {
    renderHook(() => useIncomingRequest(null));

    expect(subscriptions.every((s) => s.enabled === false)).toBe(true);
  });
});
