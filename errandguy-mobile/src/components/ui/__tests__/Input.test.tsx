import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';
import { Input } from '../Input';
import { CHROME_MAX_FONT_SCALE } from '../../../constants/fontScale';

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

  // ── Accessibility ─────────────────────────────────────────────────────
  // RN has no `aria-describedby` and `accessibilityState` has no `invalid`
  // key, so the field's own label is the only association mechanism between
  // an input and the error text rendered under it.

  it('folds the error into the field accessibilityLabel', () => {
    const { getByPlaceholderText } = render(
      <Input
        label="Email"
        placeholder="Enter email"
        value=""
        error="Enter a valid email address."
        onChangeText={jest.fn()}
      />,
    );
    expect(getByPlaceholderText('Enter email').props.accessibilityLabel).toBe(
      'Email, error: Enter a valid email address.',
    );
  });

  it('uses the plain label when there is no error', () => {
    const { getByPlaceholderText } = render(
      <Input label="Email" placeholder="Enter email" value="" onChangeText={jest.fn()} />,
    );
    expect(getByPlaceholderText('Enter email').props.accessibilityLabel).toBe('Email');
  });

  it('falls back to the placeholder when the field has no label', () => {
    const { getByPlaceholderText } = render(
      <Input placeholder="Amount" value="" error="Too low." onChangeText={jest.fn()} />,
    );
    expect(getByPlaceholderText('Amount').props.accessibilityLabel).toBe(
      'Amount, error: Too low.',
    );
  });

  it('exposes helperText as the accessibility hint', () => {
    const { getByPlaceholderText } = render(
      <Input
        label="Phone"
        placeholder="09XXXXXXXXX"
        value=""
        helperText="We only use this to reach your runner."
        onChangeText={jest.fn()}
      />,
    );
    expect(getByPlaceholderText('09XXXXXXXXX').props.accessibilityHint).toBe(
      'We only use this to reach your runner.',
    );
  });

  it('announces the error on iOS, where the live region and role="alert" do nothing', async () => {
    // NOTE: react-native's jest setup already replaces announceForAccessibility
    // with a jest.fn(), and jest.spyOn on an existing mock returns that SAME
    // mock — call history carries over from earlier tests in this file, so it
    // has to be cleared explicitly. The announce is batched onto a microtask
    // (see utils/validation/announceFieldError), hence the flush.
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
    announce.mockClear();
    const flush = () => act(async () => {});
    try {
      const { rerender } = render(
        <Input label="Email" value="" onChangeText={jest.fn()} />,
      );
      await flush();
      expect(announce).not.toHaveBeenCalled();

      rerender(<Input label="Email" value="" error="Enter a valid email address." onChangeText={jest.fn()} />);
      await flush();
      expect(announce).toHaveBeenCalledWith('Email, error: Enter a valid email address.');

      // A re-render with the SAME error (every keystroke of a still-invalid
      // field) must not re-interrupt the screen reader.
      announce.mockClear();
      rerender(<Input label="Email" value="a" error="Enter a valid email address." onChangeText={jest.fn()} />);
      await flush();
      expect(announce).not.toHaveBeenCalled();

      // A different message is worth speaking.
      rerender(<Input label="Email" value="a" error="That email is already taken." onChangeText={jest.fn()} />);
      await flush();
      expect(announce).toHaveBeenCalledWith('Email, error: That email is already taken.');
    } finally {
      announce.mockReset();
    }
  });

  it('does not announce on Android — the live region on the error text already does', async () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
    announce.mockClear();
    try {
      const { rerender } = render(<Input label="Email" value="" onChangeText={jest.fn()} />);
      rerender(<Input label="Email" value="" error="Enter a valid email address." onChangeText={jest.fn()} />);
      await act(async () => {});
      expect(announce).not.toHaveBeenCalled();
    } finally {
      announce.mockReset();
      Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    }
  });

  it('collapses a whole form of errors into one spoken sentence', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
    announce.mockClear();
    try {
      // What a submit-time validation failure looks like: every field flips to
      // an error in the same commit. iOS announcements interrupt each other,
      // so speaking them individually would leave only the LAST one audible.
      const Form = ({ invalid }: { invalid: boolean }) => (
        <>
          <Input label="First name" value="" error={invalid ? 'Enter your first name.' : undefined} onChangeText={jest.fn()} />
          <Input label="Email" value="" error={invalid ? 'Enter a valid email address.' : undefined} onChangeText={jest.fn()} />
          <Input label="Password" value="" error={invalid ? 'Use at least 8 characters.' : undefined} onChangeText={jest.fn()} />
        </>
      );
      const { rerender } = render(<Form invalid={false} />);
      await act(async () => {});
      announce.mockClear();

      rerender(<Form invalid />);
      await act(async () => {});

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith(
        '3 fields need attention. First name, error: Enter your first name.',
      );
    } finally {
      announce.mockReset();
    }
  });

  it('keeps the live region on the error text only', () => {
    const { getByText } = render(
      <Input label="Email" value="" error="Enter a valid email address." onChangeText={jest.fn()} />,
    );
    const errorText = getByText('Enter a valid email address.');
    expect(errorText.props.accessibilityLiveRegion).toBe('polite');
    expect(errorText.props.accessibilityRole).toBe('alert');
  });

  it('caps the small captions at the chrome font-scale multiplier', () => {
    const { getByText } = render(
      <Input label="Email" value="" error="Enter a valid email address." onChangeText={jest.fn()} />,
    );
    expect(getByText('Email').props.maxFontSizeMultiplier).toBe(CHROME_MAX_FONT_SCALE);
    expect(getByText('Enter a valid email address.').props.maxFontSizeMultiplier).toBe(
      CHROME_MAX_FONT_SCALE,
    );
  });

  it('leaves the field text itself free to scale with the OS setting', () => {
    const { getByPlaceholderText } = render(
      <Input label="Email" placeholder="Enter email" value="" onChangeText={jest.fn()} />,
    );
    expect(getByPlaceholderText('Enter email').props.maxFontSizeMultiplier).toBeUndefined();
  });
});
