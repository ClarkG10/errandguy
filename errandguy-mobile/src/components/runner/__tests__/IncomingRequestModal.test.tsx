import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';
import { IncomingRequestModal } from '../IncomingRequestModal';
import { makeBooking } from '../../../__mocks__/factories';
import type { Booking } from '../../../types';

const matchedOffer = (extra: Record<string, unknown> = {}): Booking =>
  ({ ...makeBooking({ status: 'matched', runner_payout: 210 }), ...extra }) as Booking;

/**
 * One act() per tick. A single act() spanning several seconds only lets the
 * FIRST timer fire — React flushes the re-render (which re-arms the next
 * timeout) at the end of the act block.
 */
function tickSeconds(seconds: number): void {
  for (let i = 0; i < seconds; i++) {
    act(() => {
      jest.advanceTimersByTime(1000);
    });
  }
}

describe('IncomingRequestModal countdown', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('reports a local timeout as an EXPIRY, never as a decline', () => {
    const onDecline = jest.fn();
    const onExpire = jest.fn();
    render(
      <IncomingRequestModal
        booking={matchedOffer()}
        onAccept={jest.fn()}
        onDecline={onDecline}
        onExpire={onExpire}
        timeoutSeconds={3}
      />,
    );

    tickSeconds(4);

    // A timeout is not a decision: POST /decline recomputes acceptance_rate,
    // which also ranks the runner inside MatchingService.
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onDecline).not.toHaveBeenCalled();
  });

  it('still falls back to onDecline when no expiry handler is supplied', () => {
    const onDecline = jest.fn();
    render(
      <IncomingRequestModal
        booking={matchedOffer()}
        onAccept={jest.fn()}
        onDecline={onDecline}
        timeoutSeconds={2}
      />,
    );

    tickSeconds(3);

    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('counts down from the server window rather than the 30s default', () => {
    const { getByText } = render(
      <IncomingRequestModal
        booking={matchedOffer()}
        onAccept={jest.fn()}
        onDecline={jest.fn()}
        onExpire={jest.fn()}
        timeoutSeconds={90}
      />,
    );
    expect(getByText('90')).toBeTruthy();

    tickSeconds(1);
    expect(getByText('89')).toBeTruthy();
  });

  it('an explicit Decline tap IS a decline', async () => {
    const onDecline = jest.fn();
    const onExpire = jest.fn();
    const { getByText } = render(
      <IncomingRequestModal
        booking={matchedOffer()}
        onAccept={jest.fn()}
        onDecline={onDecline}
        onExpire={onExpire}
        timeoutSeconds={30}
      />,
    );

    await act(async () => {
      fireEvent.press(getByText('Decline'));
    });

    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
