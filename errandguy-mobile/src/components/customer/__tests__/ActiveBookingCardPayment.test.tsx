import React from 'react';
import { render } from '@testing-library/react-native';
import { ActiveBookingCard } from '../ActiveBookingCard';
import { makeBooking } from '../../../__mocks__/factories';

/**
 * Home's "your errand" card for a GCash/Maya booking still waiting for its
 * payment. Nobody is offered the errand until it's paid, so the card must not
 * pulse "Finding a runner nearby" — it says what it's actually waiting on and
 * that a tap is the way to pay.
 */
describe('ActiveBookingCard — waiting for payment', () => {
  it('headlines the payment and points at completing it', () => {
    const { getByText, queryByText } = render(
      <ActiveBookingCard
        booking={makeBooking({ status: 'pending', awaiting_payment: true, checkout_url: 'https://x' })}
        onPress={() => {}}
      />,
    );
    expect(getByText('Waiting for your payment')).toBeTruthy();
    expect(getByText('Tap to complete payment')).toBeTruthy();
    expect(queryByText('Finding a runner nearby')).toBeNull();
  });

  it('keeps the search copy once paid (or on an older server)', () => {
    const { getByText } = render(
      <ActiveBookingCard booking={makeBooking({ status: 'pending' })} onPress={() => {}} />,
    );
    expect(getByText('Finding a runner nearby')).toBeTruthy();
  });
});
