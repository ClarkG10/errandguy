import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ChangePasswordSheet } from '../ChangePasswordSheet';
import { VerifyEmailSheet } from '../VerifyEmailSheet';
import { authService } from '../../../services/auth.service';
import { userService } from '../../../services/user.service';
import { useAuthStore } from '../../../stores/authStore';
import type { User } from '../../../types';

jest.mock('../../../services/auth.service', () => ({
  authService: {
    changePassword: jest.fn(),
    sendEmailVerification: jest.fn(),
    verifyEmail: jest.fn(),
  },
}));
jest.mock('../../../services/user.service', () => ({
  userService: { getProfile: jest.fn() },
}));
jest.mock('../../../services/pushToken', () => ({
  currentPushToken: jest.fn(() => 'ExponentPushToken[abc]'),
}));

const changePassword = authService.changePassword as jest.Mock;
const sendCode = authService.sendEmailVerification as jest.Mock;
const verifyEmail = authService.verifyEmail as jest.Mock;
const getProfile = userService.getProfile as jest.Mock;

const wrap = (ui: React.ReactElement) =>
  render(
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}
    >
      {ui}
    </SafeAreaProvider>,
  );

const user = { id: 'u1', role: 'customer', email: 'ana@example.com', email_verified: false } as unknown as User;

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ user, userIsProvisional: false });
  changePassword.mockResolvedValue({ data: {} });
  sendCode.mockResolvedValue({ data: {} });
  verifyEmail.mockResolvedValue({ data: {} });
  getProfile.mockResolvedValue({ data: { data: { ...user, email_verified: true } } });
});

describe('Change password', () => {
  const fill = (s: ReturnType<typeof wrap>) => {
    fireEvent.changeText(s.getByLabelText('Current Password'), 'Old#pass1');
    fireEvent.changeText(s.getByLabelText('New Password'), 'Errand#2026');
    fireEvent.changeText(s.getByLabelText('Confirm New Password'), 'Errand#2026');
  };

  it('sends current + new + confirm and closes', async () => {
    const onClose = jest.fn();
    const s = wrap(<ChangePasswordSheet visible onClose={onClose} />);
    fill(s);
    await act(async () => {
      fireEvent.press(s.getByText('Change Password'));
    });
    expect(changePassword).toHaveBeenCalledWith({
      current_password: 'Old#pass1',
      password: 'Errand#2026',
      password_confirmation: 'Errand#2026',
      // Keeps THIS phone's push registration when the others are dropped.
      device_token: 'ExponentPushToken[abc]',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('adopts a rotated token if the server hands one back', async () => {
    const setToken = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ setToken });
    changePassword.mockResolvedValue({ data: { token: 'fresh-token' } });
    const s = wrap(<ChangePasswordSheet visible onClose={jest.fn()} />);
    fill(s);
    await act(async () => {
      fireEvent.press(s.getByText('Change Password'));
    });
    expect(setToken).toHaveBeenCalledWith('fresh-token');
  });

  it('a wrong current password is shown under that field, and the sheet stays open', async () => {
    changePassword.mockRejectedValue({
      status: 422,
      message: 'The current password is incorrect.',
      errors: { current_password: ['The current password is incorrect.'] },
    });
    const onClose = jest.fn();
    const s = wrap(<ChangePasswordSheet visible onClose={onClose} />);
    fill(s);
    await act(async () => {
      fireEvent.press(s.getByText('Change Password'));
    });
    await waitFor(() => expect(s.getByText('The current password is incorrect.')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a non-field failure is said INSIDE the sheet (a toast would be hidden behind it)', async () => {
    changePassword.mockRejectedValue({ status: 0, message: 'Network error. Please check your connection.' });
    const s = wrap(<ChangePasswordSheet visible onClose={jest.fn()} />);
    fill(s);
    await act(async () => {
      fireEvent.press(s.getByText('Change Password'));
    });
    await waitFor(() => expect(s.getByRole('alert')).toBeTruthy());
  });
});

describe('Verify email', () => {
  it('opening sends the code; six digits verify and flip email_verified', async () => {
    const onClose = jest.fn();
    const s = wrap(<VerifyEmailSheet visible email="ana@example.com" onClose={onClose} />);
    await waitFor(() => expect(sendCode).toHaveBeenCalledWith('ana@example.com'));
    expect(await s.findByText(/We’ve emailed you a 6-digit code at/)).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(s.getByLabelText('Digit 1 of 6'), '654321');
    });

    expect(verifyEmail).toHaveBeenCalledWith('ana@example.com', '654321');
    expect(useAuthStore.getState().user?.email_verified).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('a wrong code stays on the cells with the attempts left', async () => {
    verifyEmail.mockRejectedValue({ status: 422, message: 'Invalid code.', attempts_remaining: 3 });
    const s = wrap(<VerifyEmailSheet visible email="ana@example.com" onClose={jest.fn()} />);
    await waitFor(() => expect(sendCode).toHaveBeenCalled());
    await act(async () => {
      fireEvent.changeText(s.getByLabelText('Digit 1 of 6'), '000000');
    });
    await waitFor(() => expect(s.getByText(/3 attempts left/)).toBeTruthy());
    expect(useAuthStore.getState().user?.email_verified).toBe(false);
  });
});

describe('both Profile screens offer account security', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');

  it.each(['app/(customer)/(tabs)/profile.tsx', 'app/(runner)/(tabs)/profile.tsx'])('%s', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/useAccountSecurity\(\)/);
    expect(src).toMatch(/label: 'Change password'/);
    expect(src).toMatch(/label: 'Sign out of all devices'/);
    // "Verify email" only while unverified.
    expect(src).toMatch(/security\.needsEmailVerification\s*\?/);
    expect(src).toMatch(/\{security\.sheets\}/);
  });

  it('never offers verification off the cold-start snapshot (it fakes email_verified:false)', () => {
    expect(read('components/settings/AccountSecurity.tsx')).toMatch(
      /needsEmailVerification: !provisional && !!email && emailVerified === false/,
    );
  });
});
