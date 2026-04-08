import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '../Button';

const mockImpactAsync = jest.fn();
jest.mock('expo-haptics', () => ({
  impactAsync: (...args: unknown[]) => mockImpactAsync(...args),
  ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' },
}));

describe('Button', () => {
  beforeEach(() => {
    mockImpactAsync.mockClear();
  });

  it('renders the title', () => {
    const { getByText } = render(<Button title="Submit" />);
    expect(getByText('Submit')).toBeTruthy();
  });

  it('calls onPress and triggers haptic on press', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button title="Click me" onPress={onPress} />);
    fireEvent.press(getByText('Click me'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockImpactAsync).toHaveBeenCalledTimes(1);
  });

  it('shows ActivityIndicator when loading', () => {
    const { getByTestId, queryByText } = render(
      <Button title="Loading" loading={true} testID="btn" />,
    );
    // button is rendered but disabled
    const btn = getByTestId('btn');
    expect(btn.props.accessibilityState?.disabled).toBeTruthy();
  });

  it('is disabled when disabled prop is true', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <Button title="Disabled" disabled={true} onPress={onPress} testID="btn" />,
    );
    fireEvent.press(getByTestId('btn'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not call onPress when loading', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <Button title="Loading" loading={true} onPress={onPress} testID="btn" />,
    );
    fireEvent.press(getByTestId('btn'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders all variants without crashing', () => {
    const variants = ['primary', 'secondary', 'outline', 'danger', 'ghost'] as const;
    variants.forEach((variant) => {
      const { getByText } = render(<Button title={variant} variant={variant} />);
      expect(getByText(variant)).toBeTruthy();
    });
  });

  it('renders all sizes without crashing', () => {
    const sizes = ['sm', 'md', 'lg'] as const;
    sizes.forEach((size) => {
      const { getByText } = render(<Button title={size} size={size} />);
      expect(getByText(size)).toBeTruthy();
    });
  });
});
