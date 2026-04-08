import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Input } from '../Input';

describe('Input', () => {
  it('renders with label', () => {
    const { getByText } = render(<Input label="Phone Number" value="" onChangeText={jest.fn()} />);
    expect(getByText('Phone Number')).toBeTruthy();
  });

  it('renders placeholder text', () => {
    const { getByPlaceholderText } = render(
      <Input label="Email" value="" placeholder="Enter email" onChangeText={jest.fn()} />,
    );
    expect(getByPlaceholderText('Enter email')).toBeTruthy();
  });

  it('displays validation error', () => {
    const { getByText } = render(
      <Input label="Email" value="" error="Email is required" onChangeText={jest.fn()} />,
    );
    expect(getByText('Email is required')).toBeTruthy();
  });

  it('calls onChangeText when typing', () => {
    const onChangeText = jest.fn();
    const { getByPlaceholderText } = render(
      <Input value="" placeholder="Type here" onChangeText={onChangeText} />,
    );
    fireEvent.changeText(getByPlaceholderText('Type here'), 'hello');
    expect(onChangeText).toHaveBeenCalledWith('hello');
  });

  it('renders password toggle for secureTextEntry', () => {
    const { getByPlaceholderText } = render(
      <Input value="" placeholder="Password" secureTextEntry onChangeText={jest.fn()} />,
    );
    const input = getByPlaceholderText('Password');
    // secureTextEntry should be true initially
    expect(input.props.secureTextEntry).toBe(true);
  });

  it('displays current value', () => {
    const { getByDisplayValue } = render(
      <Input value="test@example.com" onChangeText={jest.fn()} />,
    );
    expect(getByDisplayValue('test@example.com')).toBeTruthy();
  });

  it('applies numeric keyboard type', () => {
    const { getByPlaceholderText } = render(
      <Input value="" placeholder="Amount" keyboardType="numeric" onChangeText={jest.fn()} />,
    );
    const input = getByPlaceholderText('Amount');
    expect(input.props.keyboardType).toBe('numeric');
  });

  it('renders without label when label not provided', () => {
    const { queryByText } = render(
      <Input value="" placeholder="No label" onChangeText={jest.fn()} />,
    );
    // no label text should be rendered
    expect(queryByText('No label')).toBeNull();
  });
});
