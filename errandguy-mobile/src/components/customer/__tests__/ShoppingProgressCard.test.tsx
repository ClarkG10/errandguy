import React from 'react';
import { render } from '@testing-library/react-native';
import { ShoppingProgressCard } from '../ShoppingProgressCard';

const item = (name: string, checked?: boolean) => ({
  id: `id-${name}`,
  name,
  qty: 2,
  checked,
  checked_at: checked ? '2026-08-29T01:00:00+08:00' : null,
});

// Serialize the tree so we can assert on nested <Text> without depending on
// RNTL's matcher traversal — same trick as PaymentBrandMark.test.tsx.
const tree = (node: React.ReactElement) => JSON.stringify(render(node).toJSON());

describe('ShoppingProgressCard', () => {
  it('renders nothing when there is no checklist', () => {
    expect(render(<ShoppingProgressCard items={[]} />).toJSON()).toBeNull();
    expect(render(<ShoppingProgressCard items={null} />).toJSON()).toBeNull();
    expect(render(<ShoppingProgressCard items={undefined} />).toJSON()).toBeNull();
  });

  it('shows the picked count and every item name', () => {
    const out = tree(
      <ShoppingProgressCard items={[item('Milk', true), item('Bread'), item('Eggs')]} />,
    );
    expect(out).toContain('1');
    expect(out).toContain('of');
    expect(out).toContain('3');
    expect(out).toContain('Milk');
    expect(out).toContain('Bread');
    expect(out).toContain('Eggs');
  });

  it('announces each row’s tick state to screen readers', () => {
    const { getByLabelText } = render(
      <ShoppingProgressCard items={[item('Milk', true), item('Bread', false)]} />,
    );
    expect(getByLabelText('Milk, quantity 2, picked up')).toBeTruthy();
    expect(getByLabelText('Bread, quantity 2, not picked yet')).toBeTruthy();
    expect(getByLabelText('Shopping progress: 1 of 2 items picked')).toBeTruthy();
  });

  it('is read-only — no row is pressable (the customer never owns the ticks)', () => {
    const { queryAllByRole } = render(
      <ShoppingProgressCard items={[item('Milk', true), item('Bread')]} />,
    );
    // Short list ⇒ no "Show all" control either, so there is no button at all.
    expect(queryAllByRole('button')).toHaveLength(0);
    expect(queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('adds the live reassurance line only while the errand is running', () => {
    const items = [item('Milk', true), item('Bread')];
    expect(tree(<ShoppingProgressCard items={items} live />)).toContain(
      'Items tick off here as your runner picks them up.',
    );
    expect(tree(<ShoppingProgressCard items={items} />)).not.toContain(
      'Items tick off here',
    );
  });

  it('switches the live line to a receipt hand-off once everything is picked', () => {
    const out = tree(<ShoppingProgressCard items={[item('Milk', true)]} live />);
    expect(out).toContain('receipt');
    expect(out).not.toContain('Items tick off here');
  });

  it('collapses a long list behind one control and expands it on tap', () => {
    const many = Array.from({ length: 12 }, (_, i) => item(`Item${i}`));
    const { getByLabelText, queryByText } = render(
      <ShoppingProgressCard items={many} />,
    );
    // 12 > threshold ⇒ first 6 shown, the rest behind the control.
    expect(queryByText('Item0')).toBeTruthy();
    expect(queryByText('Item5')).toBeTruthy();
    expect(queryByText('Item11')).toBeNull();
    expect(getByLabelText('Show all 12 items')).toBeTruthy();
  });

  it('shows every row without a control at the collapse threshold', () => {
    const eight = Array.from({ length: 8 }, (_, i) => item(`Item${i}`));
    const { queryByText, queryAllByRole } = render(
      <ShoppingProgressCard items={eight} />,
    );
    expect(queryByText('Item7')).toBeTruthy();
    expect(queryAllByRole('button')).toHaveLength(0);
  });
});
