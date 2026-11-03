import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ShoppingChecklist } from '../ShoppingChecklist';
import type { ChecklistItem } from '../../../types/booking';

/**
 * The "Buy for me" list. It used to open empty — a hint and an "Add item"
 * button to tap before anything could be typed. It now opens on one blank
 * row, ready to type into, without writing an empty item into the draft.
 */
describe('ShoppingChecklist', () => {
  const renderList = (value: ChecklistItem[], onChange = jest.fn()) =>
    render(<ShoppingChecklist title="What should the runner buy?" value={value} onChange={onChange} />);

  it('opens on one blank row ready to type, and reports nothing until it is used', () => {
    const onChange = jest.fn();
    const utils = renderList([], onChange);
    expect(utils.getByLabelText('Item 1 name')).toBeTruthy();
    // Nothing to remove yet.
    expect(utils.queryByLabelText(/^Remove /)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('typing into the blank row makes it the first item', () => {
    const onChange = jest.fn();
    const utils = renderList([], onChange);
    fireEvent.changeText(utils.getByLabelText('Item 1 name'), 'Eggs');
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'Eggs', qty: 1 })]);
  });

  it('the stepper works on the blank row too', () => {
    const onChange = jest.fn();
    const utils = renderList([], onChange);
    fireEvent.press(utils.getByLabelText('Increase quantity of item 1'));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ name: '', qty: 2 })]);
  });

  it('"Add item" on the blank row adds nothing — the row is already there', () => {
    const onChange = jest.fn();
    const utils = renderList([], onChange);
    fireEvent.press(utils.getByLabelText('Add item'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a real list renders as before, with remove controls', () => {
    const onChange = jest.fn();
    const utils = renderList(
      [
        { id: 'a', name: 'Rice', qty: 1 },
        { id: 'b', name: 'Milk', qty: 2 },
      ],
      onChange,
    );
    expect(utils.getByText('2 items')).toBeTruthy();
    fireEvent.press(utils.getByLabelText('Remove Rice'));
    expect(onChange).toHaveBeenCalledWith([{ id: 'b', name: 'Milk', qty: 2 }]);
    fireEvent.press(utils.getByLabelText('Add item'));
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'a', name: 'Rice', qty: 1 },
      { id: 'b', name: 'Milk', qty: 2 },
      expect.objectContaining({ name: '', qty: 1 }),
    ]);
  });
});
