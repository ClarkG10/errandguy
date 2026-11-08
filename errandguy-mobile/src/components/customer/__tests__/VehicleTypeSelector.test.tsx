import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { VehicleTypeSelector, type VehicleOption } from '../VehicleTypeSelector';

/**
 * The Review screen's vehicle chooser: one row per vehicle with its real
 * price, and a "Cheapest" / "Fastest" tag only where the data makes it true
 * for exactly one vehicle — never a filler badge.
 */

const opt = (key: string, label: string, estimatedTotal: number, eta?: string): VehicleOption => ({
  key,
  label,
  perKm: 0,
  estimatedTotal,
  eta,
});

const PRICED = [
  opt('walk', 'Walk', 108.36, '35 min'),
  opt('bicycle', 'Bicycle', 109.69, '12 min'),
  opt('motorcycle', 'Motorcycle', 120.15, '5 min'),
  opt('car', 'Car', 187.53, '6 min'),
];

const row = (utils: ReturnType<typeof render>, name: string) =>
  utils.getByLabelText(new RegExp(`^${name},`));

describe('VehicleTypeSelector', () => {
  it('lists every vehicle with its price and marks the chosen one', () => {
    const utils = render(<VehicleTypeSelector options={PRICED} selectedKey="motorcycle" onSelect={jest.fn()} />);
    expect(utils.getByText('₱108.36')).toBeTruthy();
    expect(utils.getByText('₱187.53')).toBeTruthy();
    expect(row(utils, 'Motorcycle').props.accessibilityState).toMatchObject({ checked: true });
    expect(row(utils, 'Walk').props.accessibilityState).toMatchObject({ checked: false });
    expect(row(utils, 'Walk').props.accessibilityRole).toBe('radio');
  });

  it('tags the one cheapest and the one fastest vehicle, from the data', () => {
    const utils = render(<VehicleTypeSelector options={PRICED} selectedKey="motorcycle" onSelect={jest.fn()} />);
    expect(utils.getAllByText('Cheapest')).toHaveLength(1);
    expect(utils.getAllByText('Fastest')).toHaveLength(1);
    expect(row(utils, 'Walk').props.accessibilityLabel).toMatch(/cheapest/);
    expect(row(utils, 'Motorcycle').props.accessibilityLabel).toMatch(/fastest/);
    // No filler badge from the old tile design.
    expect(utils.queryByText('BEST PRICE')).toBeNull();
  });

  it('shows no tag when it would not single anything out', () => {
    const tied = [opt('walk', 'Walk', 100, '10 min'), opt('car', 'Car', 100, '10 min')];
    const utils = render(<VehicleTypeSelector options={tied} selectedKey="walk" onSelect={jest.fn()} />);
    expect(utils.queryByText('Cheapest')).toBeNull();
    expect(utils.queryByText('Fastest')).toBeNull();
  });

  it('shows no price tag while the fare is still loading', () => {
    const loading = PRICED.map((o) => ({ ...o, estimatedTotal: 0, eta: undefined }));
    const utils = render(<VehicleTypeSelector options={loading} selectedKey="motorcycle" onSelect={jest.fn()} />);
    expect(utils.queryByText('Cheapest')).toBeNull();
    expect(utils.queryByText(/₱/)).toBeNull();
  });

  it('selects a vehicle on tap', () => {
    const onSelect = jest.fn();
    const utils = render(<VehicleTypeSelector options={PRICED} selectedKey="motorcycle" onSelect={onSelect} />);
    fireEvent.press(row(utils, 'Car'));
    expect(onSelect).toHaveBeenCalledWith('car');
  });
});
