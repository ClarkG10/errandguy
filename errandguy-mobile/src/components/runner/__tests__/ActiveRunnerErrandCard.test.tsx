import React from 'react';
import { render } from '@testing-library/react-native';
import { ActiveRunnerErrandCard } from '../ActiveRunnerErrandCard';
import { statusActionLabel } from '../StatusActionButton';
import { makeBooking } from '../../../__mocks__/factories';
import type { Booking, BookingStatus } from '../../../types';

/**
 * The runner home card carried its own action vocabulary and disagreed with
 * the cockpit button it opens — "Mark item picked up" on the card over a
 * cockpit reading "Pick up item", "Mark delivered" over "Hand over item" — and
 * its drop-off wording described a leg that single-location errands don't
 * have, so a bill payment mid-errand read "En route to drop-off".
 *
 * Both now read `statusActionLabel`, the per-errand-type ladder.
 */
const errand = (status: BookingStatus, slug: string): Booking =>
  makeBooking({
    status,
    errand_type: { slug, name: slug } as Booking['errand_type'],
    customer: { full_name: 'Mia Reyes' } as Booking['customer'],
  });

describe('ActiveRunnerErrandCard title', () => {
  it('names the same action the cockpit button will show', () => {
    const { getByText } = render(
      <ActiveRunnerErrandCard errand={errand('arrived_at_pickup', 'delivery')} onPress={() => {}} />,
    );
    expect(getByText(statusActionLabel('arrived_at_pickup', 'delivery')!)).toBeTruthy();
    expect(getByText('Pick up item')).toBeTruthy();
  });

  it('does not promise a drop-off leg on a single-location errand', () => {
    const { getByText, queryByText } = render(
      <ActiveRunnerErrandCard errand={errand('picked_up', 'bills_payment')} onPress={() => {}} />,
    );
    expect(getByText('Mark as completed')).toBeTruthy();
    expect(queryByText('En route to drop-off')).toBeNull();
  });

  it('uses the ride vocabulary on a passenger trip', () => {
    const { getByText } = render(
      <ActiveRunnerErrandCard errand={errand('arrived_at_pickup', 'transportation')} onPress={() => {}} />,
    );
    expect(getByText('Start ride')).toBeTruthy();
  });

  it('asks the runner to claim an offered errand rather than to head out', () => {
    const { getByText } = render(
      <ActiveRunnerErrandCard errand={errand('matched', 'delivery')} onPress={() => {}} />,
    );
    // Same special case the cockpit button makes: `matched` is not yet theirs.
    expect(getByText('Accept errand')).toBeTruthy();
  });
});
