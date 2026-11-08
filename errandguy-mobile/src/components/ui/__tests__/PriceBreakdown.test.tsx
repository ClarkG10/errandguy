import React from 'react';
import { render } from '@testing-library/react-native';
import { PriceBreakdown, sentenceCaseLabel } from '../PriceBreakdown';

const items = [
  { label: 'Base Fee', amount: 50 },
  { label: 'Distance Fee', amount: 30 },
  { label: 'Convenience Fee', amount: 12 },
];

describe('PriceBreakdown', () => {
  it('renders all price items, labels in sentence case', () => {
    const { getByText } = render(<PriceBreakdown items={items} total={92} />);
    expect(getByText('Base fee')).toBeTruthy();
    expect(getByText('Distance fee')).toBeTruthy();
    expect(getByText('Convenience fee')).toBeTruthy();
  });

  it('hides a zero-value row (no "Surcharge ₱0.00") unless asked to show it', () => {
    const withZero = [...items, { label: 'Surcharge', amount: 0 }];
    const hidden = render(<PriceBreakdown items={withZero} total={92} />);
    expect(hidden.queryByText('Surcharge')).toBeNull();
    hidden.unmount();
    const shown = render(<PriceBreakdown items={withZero} total={92} showZeroRows />);
    expect(shown.getByText('Surcharge')).toBeTruthy();
  });

  it('keeps the case of proper nouns and acronyms', () => {
    expect(sentenceCaseLabel('GCash Fee')).toBe('GCash fee');
    expect(sentenceCaseLabel('Promo Discount')).toBe('Promo discount');
    expect(sentenceCaseLabel('VAT On Fees')).toBe('VAT on fees');
    expect(sentenceCaseLabel('ErrandGuy Wallet Credit')).toBe('ErrandGuy wallet credit');
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
    expect(getByText('Promo discount')).toBeTruthy();
    expect(getByText('₱80.00')).toBeTruthy();
  });

  it('groups thousands to match formatCurrency everywhere else', () => {
    const { getAllByText } = render(
      <PriceBreakdown
        items={[{ label: 'Base Fee', amount: 1234.5 }]}
        total={1234.5}
      />,
    );
    // Item row and total both show the grouped en-PH format.
    expect(getAllByText('₱1,234.50')).toHaveLength(2);
  });

  it('groups thousands for custom currency symbols too', () => {
    const { getAllByText } = render(
      <PriceBreakdown
        items={[{ label: 'Fee', amount: 5000 }]}
        total={5000}
        currency="$"
      />,
    );
    expect(getAllByText('$5,000.00')).toHaveLength(2);
  });

  it('renders with empty items list', () => {
    const { getByText } = render(<PriceBreakdown items={[]} total={0} />);
    expect(getByText('Total')).toBeTruthy();
    expect(getByText('₱0.00')).toBeTruthy();
  });
});
