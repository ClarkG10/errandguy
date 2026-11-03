import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AlertCircle } from 'lucide-react-native';
import { ErrorState } from '../ErrorState';

describe('ErrorState', () => {
  it('renders the default title and a description that blames nobody', () => {
    const { getByText, queryByText } = render(<ErrorState />);
    expect(getByText("Couldn't load this")).toBeTruthy();
    expect(getByText('Please try again.')).toBeTruthy();
    // A 500 or a 404 is not the person's connection.
    expect(queryByText(/connection/i)).toBeNull();
  });

  it('says "check your connection" only when the error was the connection', () => {
    const offline = render(
      <ErrorState error={{ status: 0, kind: 'offline', message: 'Network Error' }} />,
    );
    expect(offline.getByText('Check your connection and try again.')).toBeTruthy();

    const server = render(
      <ErrorState error={{ status: 500, kind: 'server', message: 'Server Error' }} />,
    );
    expect(server.getByText("This one's on us — please try again in a moment.")).toBeTruthy();
    expect(server.queryByText(/connection/i)).toBeNull();
  });

  it('shows the server-worded reason for a specific refusal', () => {
    const { getByText } = render(
      <ErrorState
        error={{ status: 403, kind: 'forbidden', message: 'This ticket is not yours.' }}
      />,
    );
    expect(getByText('This ticket is not yours.')).toBeTruthy();
  });

  it('never shows a raw JS exception message', () => {
    const { getByText, queryByText } = render(
      <ErrorState error={new TypeError("Cannot read properties of undefined (reading 'id')")} />,
    );
    expect(getByText('Please try again.')).toBeTruthy();
    expect(queryByText(/Cannot read/)).toBeNull();
  });

  it('keeps an explicit description over the error', () => {
    const { getByText } = render(
      <ErrorState
        description="Pull down to try again."
        error={{ status: 0, kind: 'offline', message: 'Network Error' }}
      />,
    );
    expect(getByText('Pull down to try again.')).toBeTruthy();
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
