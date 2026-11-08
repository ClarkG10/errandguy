import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ActiveBookingCard } from '../ActiveBookingCard';
import { makeBooking } from '../../../__mocks__/factories';

/**
 * Home's "your errand" card for a GCash/Maya booking still waiting for its
 * payment. Nobody is offered the errand until it's paid, so the card must not
 * pulse "Finding a runner nearby" — it says what it's actually waiting on,
 * when it has to be paid by, and (when there's a checkout to reopen) leads
 * with the payment itself as its one primary action.
 */
describe('ActiveBookingCard — waiting for payment', () => {
  it('headlines the payment, by method when known, with its deadline', () => {
    const { getByText, queryByText } = render(
      <ActiveBookingCard
        booking={makeBooking({
          status: 'pending',
          awaiting_payment: true,
          payment_method: 'gcash',
          checkout_url: 'https://x',
        })}
        onPress={() => {}}
      />,
    );
    expect(getByText('Waiting for your GCash payment')).toBeTruthy();
    // When it must be paid by (or the 15-minute rule) — not "Tap to …".
    expect(getByText(/Pay by .+, or this errand is cancelled\.|left unpaid for 15 minutes/)).toBeTruthy();
    expect(queryByText('Tap to complete payment')).toBeNull();
    expect(queryByText('Usually takes under a minute')).toBeNull();
    expect(queryByText('Looking for a runner nearby…')).toBeNull();
  });

  it('falls back to the generic headline when the method is unknown', () => {
    const { getByText } = render(
      <ActiveBookingCard
        booking={makeBooking({ status: 'pending', awaiting_payment: true })}
        onPress={() => {}}
      />,
    );
    expect(getByText('Waiting for your payment')).toBeTruthy();
  });

  it('ends in the primary action instead of the View pill', () => {
    const pay = jest.fn();
    const open = jest.fn();
    const { getByText, queryByText, getByLabelText } = render(
      <ActiveBookingCard
        booking={makeBooking({ status: 'pending', awaiting_payment: true, payment_method: 'maya' })}
        onPress={open}
        primaryAction={{ label: 'Pay ₱92.00', onPress: pay }}
      />,
    );
    expect(queryByText('View')).toBeNull();
    fireEvent.press(getByText('Pay ₱92.00'));
    expect(pay).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    // The rest of the card still opens the errand.
    fireEvent.press(getByLabelText(/^Active errand: Waiting for your Maya payment/));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('keeps the search copy once paid (or on an older server)', () => {
    const { getByText } = render(
      <ActiveBookingCard booking={makeBooking({ status: 'pending' })} onPress={() => {}} />,
    );
    expect(getByText('Looking for a runner nearby…')).toBeTruthy();
    expect(getByText('Usually takes under a minute')).toBeTruthy();
  });
});
