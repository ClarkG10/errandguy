import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider, TOAST_MAX_LINES, toastDuration } from '../ToastProvider';
import { toast, useToastStore } from '../../../stores/toastStore';

/**
 * Some toasts are the only receipt for money that just moved (a cancel's
 * refund, a withdrawal). They used to vanish after a flat 4s and truncate at
 * 3 lines, so a long receipt couldn't be read to the end.
 */

const RECEIPT =
  'Errand cancelled. ₱480.00 was refunded to your ErrandGuy wallet (new balance ₱1,230.00).';

const renderProvider = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ToastProvider />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.useFakeTimers();
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('toast dwell time', () => {
  it('stays up longer for a longer message', () => {
    expect(toastDuration('Saved.', false)).toBeGreaterThanOrEqual(4000);
    expect(toastDuration(RECEIPT, false)).toBeGreaterThan(toastDuration('Saved.', false) + 3000);
  });

  it('gives an action toast its extra beat', () => {
    expect(toastDuration('Notification deleted', true)).toBeGreaterThan(
      toastDuration('Notification deleted', false),
    );
  });

  it('never parks over the screen for more than 10 seconds', () => {
    expect(toastDuration('x'.repeat(2000), false)).toBe(10_000);
    expect(toastDuration('x'.repeat(2000), true)).toBe(10_000);
  });
});

describe('ToastProvider', () => {
  it('shows a money receipt across up to five lines, for every variant', () => {
    toast.success(RECEIPT);
    toast.error('Couldn’t cancel this errand. Please try again.');
    const { getByText } = renderProvider();

    expect(getByText(RECEIPT).props.numberOfLines).toBe(TOAST_MAX_LINES);
    expect(TOAST_MAX_LINES).toBe(5);
    expect(
      getByText('Couldn’t cancel this errand. Please try again.').props.numberOfLines,
    ).toBe(TOAST_MAX_LINES);
  });

  it('arms its dismiss timer for the scaled time, not the old flat 4 seconds', () => {
    // (The reanimated mock never runs the exit animation's callback, so the
    // timer itself is what's checked.)
    const spy = jest.spyOn(global, 'setTimeout');
    toast.success(RECEIPT);
    renderProvider();

    const delays = spy.mock.calls.map((c) => c[1]);
    expect(delays).toContain(toastDuration(RECEIPT, false));
    expect(delays).not.toContain(4000);
    spy.mockRestore();
  });
});
