import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Inbox } from 'lucide-react-native';
import { Button } from '../Button';
import { Input } from '../Input';
import { EmptyState } from '../EmptyState';
import { SlowNetworkNotice, useSlowLoading } from '../SlowNetworkNotice';
import { PermissionPrompt } from '../PermissionSheet';
import { SuccessCheck } from '../SuccessCheck';
import {
  SessionExpiredModal,
  hasBookingDraft,
  sessionExpiredBody,
} from '../../auth/SessionExpiredModal';

/**
 * The shared pieces behind the app's state patterns (empty, slow network,
 * permission denied, form validation, session expired, success).
 */

describe('Button — a disabled CTA says why (pattern 9)', () => {
  it('shows the reason under a disabled button and reads it as the hint', () => {
    const { getByText, getByRole } = render(
      <Button title="Log in" disabled disabledReason="Enter your password" onPress={jest.fn()} />,
    );
    expect(getByText('Enter your password')).toBeTruthy();
    expect(getByRole('button').props.accessibilityHint).toBe('Enter your password');
  });

  it('hides the reason once the button is enabled, and while loading', () => {
    const enabled = render(<Button title="Log in" disabledReason="Enter your password" />);
    expect(enabled.queryByText('Enter your password')).toBeNull();
    const loading = render(<Button title="Log in" disabled loading disabledReason="Enter your password" />);
    expect(loading.queryByText('Enter your password')).toBeNull();
  });

  it('renders exactly as before when no reason is passed', () => {
    const { queryByText } = render(<Button title="Save" disabled />);
    expect(queryByText('Save')).toBeTruthy();
  });
});

describe('Input — error and valid states (pattern 9)', () => {
  it('flags an error with an icon in the field and the fix underneath', () => {
    const { getByText, getByTestId, queryByTestId } = render(
      <Input label="Email" value="juan@gmail" error="Add a domain, like name@gmail.com" valid />,
    );
    expect(getByText('Add a domain, like name@gmail.com')).toBeTruthy();
    expect(getByTestId('input-error-icon')).toBeTruthy();
    // An error always wins over `valid`.
    expect(queryByTestId('input-valid-tick')).toBeNull();
  });

  it('shows the success tick only on a filled, valid field', () => {
    expect(render(<Input label="Email" value="juan@gmail.com" valid />).getByLabelText('Email looks good')).toBeTruthy();
    expect(render(<Input label="Email" value="" valid />).queryByTestId('input-valid-tick')).toBeNull();
    expect(render(<Input label="Email" value="juan@gmail.com" />).queryByTestId('input-valid-tick')).toBeNull();
  });
});

describe('EmptyState — one next step (pattern 1)', () => {
  it('renders the why and a single primary action', () => {
    const onAction = jest.fn();
    const { getByText } = render(
      <EmptyState
        icon={Inbox}
        title="No notifications yet"
        description="We'll let you know when a runner accepts your errand."
        actionLabel="Book an errand"
        onAction={onAction}
      />,
    );
    expect(getByText("We'll let you know when a runner accepts your errand.")).toBeTruthy();
    fireEvent.press(getByText('Book an errand'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe('Slow network (pattern 5)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('appears only after ~4s of the same wait, and goes when it ends', () => {
    const onRetry = jest.fn();
    const screen = render(<SlowNetworkNotice loading onRetry={onRetry} />);
    expect(screen.queryByText('Still loading · slow connection')).toBeNull();
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.getByText('Still loading · slow connection')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    screen.rerender(<SlowNetworkNotice loading={false} onRetry={onRetry} />);
    expect(screen.queryByText('Still loading · slow connection')).toBeNull();
  });

  it('offers a lighter path only when one is given', () => {
    const onLighter = jest.fn();
    const { getByText } = render(
      <SlowNetworkNotice visible lighterPathLabel="Type the address instead" onLighterPath={onLighter} />,
    );
    fireEvent.press(getByText('Type the address instead'));
    expect(onLighter).toHaveBeenCalledTimes(1);
  });

  it('shows real progress when the screen knows it', () => {
    const { getByText } = render(<SlowNetworkNotice visible progress={0.33} label="Uploading photos · 2 of 6" />);
    expect(getByText('33%')).toBeTruthy();
  });

  it('useSlowLoading restarts its clock on every new wait', () => {
    const seen: boolean[] = [];
    function Probe({ active }: { active: boolean }) {
      seen.push(useSlowLoading(active, 1000));
      return null;
    }
    const probe = render(<Probe active />);
    act(() => {
      jest.advanceTimersByTime(999);
    });
    expect(seen[seen.length - 1]).toBe(false);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(seen[seen.length - 1]).toBe(true);
    probe.rerender(<Probe active={false} />);
    expect(seen[seen.length - 1]).toBe(false);
  });
});

describe('PermissionPrompt (pattern 7)', () => {
  it('says why, opens Settings, and offers the alternative', () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as never);
    const onAlternative = jest.fn();
    const { getByText } = render(
      <PermissionPrompt kind="camera" alternativeLabel="Choose from gallery instead" onAlternative={onAlternative} />,
    );
    expect(getByText('Camera is off for ErrandGuy')).toBeTruthy();
    expect(getByText(/uses the camera only/)).toBeTruthy();
    fireEvent.press(getByText('Allow in Settings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
    fireEvent.press(getByText('Choose from gallery instead'));
    expect(onAlternative).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });
});

describe('Session expired (pattern 8)', () => {
  it('mentions the draft only when there is one', () => {
    expect(sessionExpiredBody(true)).toBe('For your security we signed you out. Your errand draft is saved.');
    expect(sessionExpiredBody(false)).toBe('For your security we signed you out.');
    expect(hasBookingDraft({})).toBe(false);
    expect(hasBookingDraft({ schedule_type: 'now' })).toBe(false);
    expect(hasBookingDraft({ pickup_address: 'SM Megamall' })).toBe(true);
  });

  it('renders the card with one way forward', () => {
    const onContinue = jest.fn();
    const { getByText } = render(<SessionExpiredModal visible draftSaved onContinue={onContinue} />);
    expect(getByText('You were signed out')).toBeTruthy();
    expect(getByText('For your security we signed you out. Your errand draft is saved.')).toBeTruthy();
    fireEvent.press(getByText('Sign in and continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe('SuccessCheck (pattern 10)', () => {
  it('grows to hold its soft halo only when asked', () => {
    const plain = render(<SuccessCheck size={72} haptic={false} testID="check" />);
    expect(plain.getByTestId('check').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: 72, height: 72 })]),
    );
    const halo = render(<SuccessCheck size={72} halo haptic={false} testID="check" />);
    expect(halo.getByTestId('check').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: 108, height: 108 })]),
    );
  });
});
