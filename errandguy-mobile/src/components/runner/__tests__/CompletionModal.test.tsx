import React from 'react';
import { Modal } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CompletionModal } from '../CompletionModal';

/**
 * The completion sheet is the money-and-proof moment at the door:
 *  - it covered the cockpit's "Collect ₱X" strip without repeating it;
 *  - a stray backdrop tap threw away work in progress;
 *  - with nobody able to sign, there was no way to finish at all, even with
 *    the delivery photo already on file.
 */

const renderSheet = (props: Partial<React.ComponentProps<typeof CompletionModal>> = {}) => {
  const onComplete = jest.fn();
  const onClose = jest.fn();
  const screen = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <CompletionModal
        bookingId="b1"
        requiresSignature
        onComplete={onComplete}
        onClose={onClose}
        {...props}
      />
    </SafeAreaProvider>,
  );
  return { screen, onComplete, onClose };
};

describe('CompletionModal', () => {
  it('repeats the cash to collect on a cash job', () => {
    const { screen } = renderSheet({ collectAmount: 215 });
    expect(screen.getByText(/Collect ₱215\.00 in cash/)).toBeTruthy();
  });

  it('says nothing about cash when there is none to collect', () => {
    const { screen } = renderSheet({ collectAmount: null });
    expect(screen.queryByText(/in cash/)).toBeNull();
  });

  it('offers no way around the signature without a delivery photo', () => {
    const { screen } = renderSheet({ canSkipSignature: false });
    expect(screen.queryByText('Can’t get a signature?')).toBeNull();
  });

  it('finishes without a signature once a reason is picked', async () => {
    const { screen, onComplete } = renderSheet({ canSkipSignature: true });

    fireEvent.press(screen.getByText('Can’t get a signature?'));
    const finish = screen.getByRole('button', { name: 'Complete without signature' });
    expect(finish.props.accessibilityState).toMatchObject({ disabled: true });

    fireEvent.press(screen.getByRole('radio', { name: 'Left with guard or reception' }));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Complete without signature' }));
    });

    expect(onComplete).toHaveBeenCalledWith('', { reason: 'left_with_guard' });
  });

  it('needs a short note for "Other"', async () => {
    const { screen, onComplete } = renderSheet({ canSkipSignature: true });

    fireEvent.press(screen.getByText('Can’t get a signature?'));
    fireEvent.press(screen.getByRole('radio', { name: 'Other' }));
    expect(
      screen.getByRole('button', { name: 'Complete without signature' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });

    fireEvent.changeText(screen.getByPlaceholderText('e.g. Left with the neighbour'), '  Gate locked, left at the store  ');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Complete without signature' }));
    });

    expect(onComplete).toHaveBeenCalledWith('', {
      reason: 'other',
      note: 'Gate locked, left at the store',
    });
  });

  it('drops a note typed for "Other" once a different reason is picked', async () => {
    const { screen, onComplete } = renderSheet({ canSkipSignature: true });

    fireEvent.press(screen.getByText('Can’t get a signature?'));
    fireEvent.press(screen.getByRole('radio', { name: 'Other' }));
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Left with the neighbour'), 'Gate locked');
    fireEvent.press(screen.getByRole('radio', { name: 'Left with guard or reception' }));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Complete without signature' }));
    });

    expect(onComplete).toHaveBeenCalledWith('', { reason: 'left_with_guard' });
  });

  it('closes straight away when nothing has been started', () => {
    const { screen, onClose } = renderSheet({ canSkipSignature: true });
    fireEvent.press(screen.getByRole('button', { name: 'Close completion form' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before throwing away work in progress — X, backdrop or Android back', () => {
    const { screen, onClose } = renderSheet({ canSkipSignature: true });
    fireEvent.press(screen.getByText('Can’t get a signature?'));
    fireEvent.press(screen.getByRole('radio', { name: 'Recipient not available' }));

    fireEvent.press(screen.getByRole('button', { name: 'Close completion form' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Leave without finishing?')).toBeTruthy();

    // Android back on the sheet itself goes through the same guard.
    act(() => {
      screen.UNSAFE_getAllByType(Modal)[0].props.onRequestClose();
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Leave'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
