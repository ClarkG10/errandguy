import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { NegotiateOfferCard } from '../NegotiateOfferCard';
import { makeBooking } from '../../../__mocks__/factories';
import type { Booking } from '../../../types';

const offer = (extra: Record<string, unknown> = {}): Booking =>
  ({
    ...makeBooking({
      pricing_mode: 'negotiate',
      customer_offer: 250,
      total_amount: 250,
      runner_payout: 210,
    }),
    ...extra,
  }) as Booking;

describe('NegotiateOfferCard', () => {
  it('leads with the runner payout, not the customer gross', () => {
    const { getByText, queryByText } = render(
      <NegotiateOfferCard booking={offer()} onPress={() => {}} />,
    );
    // Take-home is the headline figure (matches the fixed-offer modal).
    expect(getByText('₱210.00')).toBeTruthy();
    // The gross is present, but only as the secondary caption.
    expect(getByText('You earn · customer pays ₱250.00')).toBeTruthy();
    expect(queryByText('₱250.00')).toBeNull();
  });

  it('falls back to "Payout pending" when the payout is unknown', () => {
    const { getAllByText } = render(
      <NegotiateOfferCard booking={offer({ runner_payout: null })} onPress={() => {}} />,
    );
    expect(getAllByText('Payout pending').length).toBeGreaterThan(0);
  });

  it('shows the cash a runner must collect in person', () => {
    const { getByText } = render(
      <NegotiateOfferCard
        booking={offer({ payment_method_type: 'cash', amount_to_collect: 250 })}
        onPress={() => {}}
      />,
    );
    expect(getByText('Collect ₱250.00')).toBeTruthy();
  });

  it('marks a prepaid job by its gateway', () => {
    const { getByText } = render(
      <NegotiateOfferCard
        booking={offer({ payment_method_type: 'gcash', amount_to_collect: null })}
        onPress={() => {}}
      />,
    );
    expect(getByText('Prepaid · GCash')).toBeTruthy();
  });

  it('exposes a direct Accept action and reports the tapped offer', () => {
    const onAccept = jest.fn();
    const { getByText } = render(
      <NegotiateOfferCard booking={offer()} onPress={() => {}} onAccept={onAccept} />,
    );
    fireEvent.press(getByText('Accept'));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('hides the Accept action when no handler is supplied', () => {
    const { queryByText } = render(
      <NegotiateOfferCard booking={offer()} onPress={() => {}} />,
    );
    expect(queryByText('Accept')).toBeNull();
  });

  it('locks every claim while another offer is being accepted', () => {
    const onAccept = jest.fn();
    const { getByText } = render(
      <NegotiateOfferCard booking={offer()} onPress={() => {}} onAccept={onAccept} busy />,
    );
    fireEvent.press(getByText('Accept'));
    expect(onAccept).not.toHaveBeenCalled();
  });
});
