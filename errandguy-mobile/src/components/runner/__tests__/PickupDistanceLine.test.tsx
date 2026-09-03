import React from 'react';
import { render } from '@testing-library/react-native';
import { PickupDistanceLine } from '../PickupDistanceLine';
import { makeBooking } from '../../../__mocks__/factories';

/**
 * `route.service.formatEtaMinutes` exists so "every surface phrases an ETA
 * identically" (its own docblock) — and had zero callers. Five surfaces
 * hand-rolled it instead, four with no hour rollover and two with a broken
 * singular: at exactly one minute out this line's screen reader said "about 1
 * minutes", and on a cross-city pickup it said "95 min" while the navigation
 * bar for the identical leg said "1h 35m".
 */
const mockEta = jest.fn();

jest.mock('../../../hooks/useEta', () => ({
  useEta: (...args: unknown[]) => mockEta(...args),
}));

jest.mock('../../../stores/locationStore', () => ({
  useLocationStore: (selector: (s: unknown) => unknown) =>
    selector({ currentLocation: { lat: 14.6, lng: 120.98 } }),
}));

const booking = makeBooking({ pickup_lat: 14.61, pickup_lng: 120.99 });

describe('PickupDistanceLine ETA phrasing', () => {
  afterEach(() => mockEta.mockReset());

  it('renders the singular at exactly one minute out', () => {
    mockEta.mockReturnValue({ distanceMeters: 400, minutes: 1 });
    const { getByText } = render(<PickupDistanceLine booking={booking} />);
    expect(getByText('Pickup 400 m · ~1 min away')).toBeTruthy();
  });

  it('rolls over to hours on a long leg instead of printing 95 min', () => {
    mockEta.mockReturnValue({ distanceMeters: 42_000, minutes: 95 });
    const { getByText } = render(<PickupDistanceLine booking={booking} />);
    expect(getByText('Pickup 42.0 km · ~1h 35m away')).toBeTruthy();
  });

  it('says the same thing to a screen reader as it does on screen', () => {
    mockEta.mockReturnValue({ distanceMeters: 400, minutes: 1 });
    const { getByLabelText } = render(<PickupDistanceLine booking={booking} />);
    expect(getByLabelText('Pickup is 400 m away, about 1 min')).toBeTruthy();
  });

  it('hides the ETA clause, not the distance, when there is no ETA yet', () => {
    mockEta.mockReturnValue({ distanceMeters: 400, minutes: null });
    const { getByText } = render(<PickupDistanceLine booking={booking} />);
    expect(getByText('Pickup 400 m')).toBeTruthy();
  });
});
