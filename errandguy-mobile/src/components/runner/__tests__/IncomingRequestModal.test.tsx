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

/**
 * Every booking is fixed-price now, so the vehicle the customer booked is what
 * priced the job — a runner on a bicycle must see "Car booked" BEFORE taking a
 * car fare, not at the doorstep.
 */
describe('IncomingRequestModal booked vehicle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const renderOffer = (booking: Booking) =>
    render(
      <IncomingRequestModal
        booking={booking}
        onAccept={jest.fn()}
        onDecline={jest.fn()}
        onExpire={jest.fn()}
        timeoutSeconds={90}
      />,
    );

  it('names the vehicle the offer was booked for', () => {
    const { getByText } = renderOffer(
      matchedOffer({ vehicle_type: 'car', vehicle_type_rate: null }),
    );

    expect(getByText('Car booked')).toBeTruthy();
  });

  it('reads the full booking payload’s vehicle_type_rate when the offer carries no vehicle_type', () => {
    const { getByText } = renderOffer(matchedOffer({ vehicle_type_rate: 'bicycle' }));

    expect(getByText('Bicycle booked')).toBeTruthy();
  });

  it('says nothing rather than guess when no known vehicle is named', () => {
    const { queryByText } = renderOffer(
      matchedOffer({ vehicle_type: 'hoverboard', vehicle_type_rate: null }),
    );

    expect(queryByText(/booked$/)).toBeNull();
  });

  it('leaves the vehicle off an on-site errand, where the customer never picks one', () => {
    const { queryByText, getByText } = renderOffer(
      matchedOffer({
        vehicle_type: 'motorcycle',
        errand_type: { id: 't-q', name: 'Queue / Pila', slug: 'queue' },
      }),
    );

    expect(getByText('On-site')).toBeTruthy();
    expect(queryByText('Motorcycle booked')).toBeNull();
  });
});
