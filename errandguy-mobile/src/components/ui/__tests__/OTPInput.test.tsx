import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { OTPInput } from '../OTPInput';

describe('OTPInput', () => {
  it('renders 6 digit inputs by default', () => {
    const { UNSAFE_getAllByType } = render(<OTPInput value="" onChange={jest.fn()} />);
    const { TextInput } = require('react-native');
    const inputs = UNSAFE_getAllByType(TextInput);
    expect(inputs).toHaveLength(6);
  });

  it('renders custom length inputs', () => {
    const { UNSAFE_getAllByType } = render(
      <OTPInput length={4} value="" onChange={jest.fn()} />,
    );
    const { TextInput } = require('react-native');
    const inputs = UNSAFE_getAllByType(TextInput);
    expect(inputs).toHaveLength(4);
  });

  it('fills digit boxes from value', () => {
    const { UNSAFE_getAllByType } = render(
      <OTPInput value="123" onChange={jest.fn()} />,
    );
    const { TextInput } = require('react-native');
    const inputs = UNSAFE_getAllByType(TextInput);
    expect(inputs[0].props.value).toBe('1');
    expect(inputs[1].props.value).toBe('2');
    expect(inputs[2].props.value).toBe('3');
    expect(inputs[3].props.value).toBe('');
  });

  it('calls onChange when a digit is entered', () => {
    const onChange = jest.fn();
    const { UNSAFE_getAllByType } = render(<OTPInput value="" onChange={onChange} />);
    const { TextInput } = require('react-native');
    const inputs = UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(inputs[0], '5');
    expect(onChange).toHaveBeenCalledWith('5');
  });

  it('displays error message', () => {
    const { getByText } = render(
      <OTPInput value="" onChange={jest.fn()} error="Invalid OTP" />,
    );
    expect(getByText('Invalid OTP')).toBeTruthy();
  });

  it('uses number-pad keyboard type', () => {
    const { UNSAFE_getAllByType } = render(<OTPInput value="" onChange={jest.fn()} />);
    const { TextInput } = require('react-native');
    const inputs = UNSAFE_getAllByType(TextInput);
    inputs.forEach((input: any) => {
      expect(input.props.keyboardType).toBe('number-pad');
    });
  });

  it('completes callback when all digits entered', () => {
    const onChange = jest.fn();
    const { UNSAFE_getAllByType } = render(
      <OTPInput value="12345" onChange={onChange} />,
    );
    const { TextInput } = require('react-native');
    const inputs = UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(inputs[5], '6');
    expect(onChange).toHaveBeenCalledWith('123456');
  });
});
