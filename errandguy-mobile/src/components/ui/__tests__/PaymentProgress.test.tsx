import React from 'react';
import { render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { PaymentProgress } from '../PaymentProgress';

/**
 * The money path's blocking overlay. It covers the screen for 10-60s while a
 * booking / top-up / tip is charged, so a screen-reader user who hears nothing
 * cannot tell whether they have been charged.
 *
 * react-native's jest setup already replaces announceForAccessibility with a
 * jest.fn(), and jest.spyOn on an existing mock returns THAT mock — so call
 * history carries across tests and has to be cleared per test.
 */
function spyOnAnnounce() {
  const spy = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => {});
  spy.mockClear();
  return spy;
}

describe('PaymentProgress accessibility', () => {
  afterEach(() => {
    (AccessibilityInfo.announceForAccessibility as jest.Mock).mockReset();
  });

  it('stays silent through the sub-second preparing / redirecting stages', () => {
    const announce = spyOnAnnounce();
    const { rerender } = render(<PaymentProgress stage="preparing" />);
    rerender(<PaymentProgress stage="redirecting" />);
    expect(announce).not.toHaveBeenCalled();
  });

  it('announces the stages the user actually waits inside', () => {
    const announce = spyOnAnnounce();
    const { rerender } = render(<PaymentProgress stage="preparing" />);

    rerender(<PaymentProgress stage="verifying" />);
    expect(announce).toHaveBeenLastCalledWith('Verifying your payment. Please wait.');

    rerender(<PaymentProgress stage="pending" />);
    expect(announce).toHaveBeenLastCalledWith(
      'Payment is being processed. You can safely leave this screen.',
    );
  });

  it('speaks the caller\'s own success title, so a tip does not announce as a booking', () => {
    const announce = spyOnAnnounce();
    render(<PaymentProgress stage="success" successTitle="Tip sent" />);
    expect(announce).toHaveBeenCalledWith('Tip sent.');
  });

  it('says the customer was not charged when the payment fails', () => {
    const announce = spyOnAnnounce();
    render(<PaymentProgress stage="failed" />);
    expect(announce).toHaveBeenCalledWith(
      "Payment didn't go through. You weren't charged.",
    );
  });

  it('re-announces when the same stage flips offline, but not on a plain re-render', () => {
    const announce = spyOnAnnounce();
    const { rerender } = render(<PaymentProgress stage="verifying" />);
    expect(announce).toHaveBeenCalledTimes(1);

    // Same stage, same connectivity — a poll tick must not re-interrupt.
    rerender(<PaymentProgress stage="verifying" />);
    expect(announce).toHaveBeenCalledTimes(1);

    // Losing the connection changes what is true, and is worth saying.
    rerender(<PaymentProgress stage="verifying" offline />);
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith(
      "Checking payment status. We'll continue once you're back online.",
    );
  });

  it('speaks again on a second attempt after the overlay is dismissed', () => {
    const announce = spyOnAnnounce();
    const { rerender } = render(<PaymentProgress stage="failed" />);
    expect(announce).toHaveBeenCalledTimes(1);
    rerender(<PaymentProgress stage={null} />);
    rerender(<PaymentProgress stage="failed" />);
    expect(announce).toHaveBeenCalledTimes(2);
  });

  it('carries the stage copy in an Android live region', () => {
    // Visually hidden (the srOnly idiom copied from book/confirm.tsx), so RNTL
    // needs includeHidden to see it.
    const { getByText } = render(<PaymentProgress stage="verifying" />);
    const live = getByText('Verifying your payment. Please wait.', { includeHiddenElements: true });
    expect(live.props.accessibilityLiveRegion).toBe('polite');
  });

  it('marks the stage title as a header', () => {
    const { getByText } = render(<PaymentProgress stage="verifying" />);
    expect(getByText('Verifying your payment…').props.accessibilityRole).toBe('header');
  });

  it('reads each receipt row as one item instead of orphaned labels and values', () => {
    const { getByLabelText } = render(
      <PaymentProgress
        stage="success"
        receipt={{ amount: 250, method: 'gcash', reference: 'REF-1', paidAt: null }}
      />,
    );
    expect(getByLabelText('Amount, ₱250.00')).toBeTruthy();
    expect(getByLabelText('Method, GCash')).toBeTruthy();
    expect(getByLabelText('Reference, REF-1')).toBeTruthy();
  });

  it('renders nothing when there is no stage', () => {
    const { toJSON } = render(<PaymentProgress stage={null} />);
    expect(toJSON()).toBeNull();
  });
});
