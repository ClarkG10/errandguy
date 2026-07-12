import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AlertCircle } from 'lucide-react-native';
import { ErrorState } from '../ErrorState';

describe('ErrorState', () => {
  it('renders the default title and description', () => {
    const { getByText } = render(<ErrorState />);
    expect(getByText("Couldn't load this")).toBeTruthy();
    expect(
      getByText('Check your internet connection and try again.'),
    ).toBeTruthy();
  });

  it('renders a custom title and description', () => {
    const { getByText } = render(
      <ErrorState
        title="Payment failed"
        description="Your card was declined."
      />,
    );
    expect(getByText('Payment failed')).toBeTruthy();
    expect(getByText('Your card was declined.')).toBeTruthy();
  });

  it('renders a Retry button and calls onRetry on press', () => {
    const onRetry = jest.fn();
    const { getByText } = render(<ErrorState onRetry={onRetry} />);
    fireEvent.press(getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('supports a custom retry label', () => {
    const onRetry = jest.fn();
    const { getByText } = render(
      <ErrorState onRetry={onRetry} retryLabel="Try again" />,
    );
    fireEvent.press(getByText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render a Retry button when onRetry is not provided', () => {
    const { queryByText } = render(<ErrorState />);
    expect(queryByText('Retry')).toBeNull();
  });

  it('renders the compact variant with title, description and retry', () => {
    const onRetry = jest.fn();
    const { getByText, getByTestId } = render(
      <ErrorState compact onRetry={onRetry} testID="error-compact" />,
    );
    expect(getByTestId('error-compact')).toBeTruthy();
    expect(getByText("Couldn't load this")).toBeTruthy();
    fireEvent.press(getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders with a custom icon without crashing', () => {
    const { getByText } = render(<ErrorState icon={AlertCircle} />);
    expect(getByText("Couldn't load this")).toBeTruthy();
  });
});
