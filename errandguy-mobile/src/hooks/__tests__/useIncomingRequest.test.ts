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

  it('subscribes to both the offer stream and its retraction', () => {
    renderHook(() => useIncomingRequest('runner-1'));

    expect(subscriptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'runner.runner-1', event: 'booking.incoming' }),
        expect.objectContaining({ channel: 'notifications.runner-1', event: 'offer.withdrawn' }),
      ]),
    );
  });

  it('opens the offer modal on an incoming matched booking', () => {
    renderHook(() => useIncomingRequest('runner-1'));

    fire('booking.incoming', offer('b1'));

    expect(useRunnerStore.getState().incomingRequest?.booking.id).toBe('b1');
  });

  /**
   * The whole point of the retraction: a runner staring at an offer someone
   * else just took should see it go, not tap it and be told BOOKING_STALE.
   */
  it('dismisses the open offer when that errand is withdrawn', () => {
    const onOfferWithdrawn = jest.fn();
    renderHook(() => useIncomingRequest('runner-1', { onOfferWithdrawn }));

    fire('booking.incoming', offer('b1'));
    fire('offer.withdrawn', { booking_id: 'b1', reason: 'taken' });

    expect(useRunnerStore.getState().incomingRequest).toBeNull();
    expect(onOfferWithdrawn).toHaveBeenCalledWith('b1');
  });

  /** A retraction for a DIFFERENT errand must not close the one being decided. */
  it('leaves an unrelated open offer alone', () => {
    const onOfferWithdrawn = jest.fn();
    renderHook(() => useIncomingRequest('runner-1', { onOfferWithdrawn }));

    fire('booking.incoming', offer('b1'));
    fire('offer.withdrawn', { booking_id: 'b2', reason: 'taken' });

    expect(useRunnerStore.getState().incomingRequest?.booking.id).toBe('b1');
    // The feed still refreshes — b2 may well be sitting in it.
    expect(onOfferWithdrawn).toHaveBeenCalledWith('b2');
  });

  it('ignores a malformed retraction', () => {
    const onOfferWithdrawn = jest.fn();
    renderHook(() => useIncomingRequest('runner-1', { onOfferWithdrawn }));

    fire('booking.incoming', offer('b1'));
    fire('offer.withdrawn', {});

    expect(useRunnerStore.getState().incomingRequest?.booking.id).toBe('b1');
    expect(onOfferWithdrawn).not.toHaveBeenCalled();
  });

  /**
   * A decline is fire-and-forget, so the booking can still be `matched` on the
   * server for a moment and be re-broadcast. Asking again reads as the app
   * ignoring the runner's answer.
   */
  it('never re-raises an offer the runner already declined', () => {
    const onOffer = jest.fn();
    renderHook(() => useIncomingRequest('runner-1', { onOffer }));

    fire('booking.incoming', offer('b1'));
    useRunnerStore.getState().declineErrand('b1');
    fire('booking.incoming', offer('b1'));

    expect(useRunnerStore.getState().incomingRequest).toBeNull();
    // The feed callback still runs — the errand may legitimately reappear in
    // the open-offer list for someone else to claim.
    expect(onOffer).toHaveBeenCalledTimes(2);
  });

  it('subscribes to nothing without a runner id', () => {
    renderHook(() => useIncomingRequest(null));

    expect(subscriptions.every((s) => s.enabled === false)).toBe(true);
  });
});
