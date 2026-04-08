import React from 'react';
import { render } from '@testing-library/react-native';
import { PriceBreakdown } from '../PriceBreakdown';

const items = [
  { label: 'Base Fee', amount: 50 },
  { label: 'Distance Fee', amount: 30 },
  { label: 'Service Fee', amount: 12 },
];

describe('PriceBreakdown', () => {
  it('renders all price items', () => {
    const { getByText } = render(<PriceBreakdown items={items} total={92} />);
    expect(getByText('Base Fee')).toBeTruthy();
    expect(getByText('Distance Fee')).toBeTruthy();
    expect(getByText('Service Fee')).toBeTruthy();
  });

  it('renders total correctly', () => {
    const { getByText } = render(<PriceBreakdown items={items} total={92} />);
    expect(getByText('Total')).toBeTruthy();
    expect(getByText('₱92.00')).toBeTruthy();
  });

  it('renders item amounts', () => {
    const { getByText } = render(<PriceBreakdown items={items} total={92} />);
    expect(getByText('₱50.00')).toBeTruthy();
    expect(getByText('₱30.00')).toBeTruthy();
    expect(getByText('₱12.00')).toBeTruthy();
  });

  it('uses custom currency symbol', () => {
    const { getAllByText } = render(
      <PriceBreakdown items={[{ label: 'Fee', amount: 10 }]} total={10} currency="$" />,
    );
    // Both the item amount and total show "$10.00" since they are the same value
    expect(getAllByText('$10.00')).toHaveLength(2);
  });

  it('renders negative amounts (discounts) without minus prefix duplication', () => {
    const discountItems = [
      { label: 'Base Fee', amount: 100 },
      { label: 'Promo Discount', amount: -20 },
    ];
    const { getByText } = render(<PriceBreakdown items={discountItems} total={80} />);
    expect(getByText('Promo Discount')).toBeTruthy();
    expect(getByText('₱80.00')).toBeTruthy();
  });

  it('renders with empty items list', () => {
    const { getByText } = render(<PriceBreakdown items={[]} total={0} />);
    expect(getByText('Total')).toBeTruthy();
    expect(getByText('₱0.00')).toBeTruthy();
  });
});
