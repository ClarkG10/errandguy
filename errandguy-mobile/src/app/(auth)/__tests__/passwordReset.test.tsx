import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import ForgotPasswordScreen from '../forgot-password';
import ResetPasswordScreen from '../reset-password';
import { authService } from '../../../services/auth.service';
import { useAuthStore } from '../../../stores/authStore';
import { useToastStore } from '../../../stores/toastStore';

/**
 * Forgot password is a CODE flow end to end: the email gets a 6-digit code,
 * the code + new password reset it in one step, and the person lands on login.
 * It used to promise a "reset link" the server never sent, and had no screen
 * to type a code into — a dead end for anyone who forgot their password.
 */

jest.mock('../../../services/auth.service', () => ({
  authService: { forgotPassword: jest.fn(), resetPassword: jest.fn() },
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
const forgot = authService.forgotPassword as jest.Mock;
const resetPw = authService.resetPassword as jest.Mock;

const wrap = (ui: React.ReactElement) =>
  render(
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}
    >
      {ui}
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue(mockRouter);
  useToastStore.setState({ toasts: [] });
  forgot.mockResolvedValue({ data: {} });
  resetPw.mockResolvedValue({ data: {} });
});

describe('forgot password — step 1 (email)', () => {
  it('sends a code and moves to the code screen with the email', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ email: 'ana@example.com' });
    const screen = wrap(<ForgotPasswordScreen />);
    expect(screen.getByText(/6-digit code/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('Send Code'));
    });

    expect(forgot).toHaveBeenCalledWith('ana@example.com');
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/(auth)/reset-password',
      params: { email: 'ana@example.com' },
    });
  });
});

describe('forgot password — step 2 (code + new password)', () => {
  const fill = (screen: ReturnType<typeof wrap>, password = 'Errand#2026', confirm = password) => {
    fireEvent.changeText(screen.getByLabelText('Digit 1 of 6'), '123456');
    fireEvent.changeText(screen.getByLabelText('New Password'), password);
    fireEvent.changeText(screen.getByLabelText('Confirm New Password'), confirm);
  };

  beforeEach(() => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ email: 'ana@example.com' });
  });

  it("says a 6-digit code was emailed — never a link", () => {
    const screen = wrap(<ResetPasswordScreen />);
    expect(screen.getByText(/We've emailed you a 6-digit code at/)).toBeTruthy();
    expect(screen.queryByText(/link/i)).toBeNull();
  });

  it('resets with the code, then goes to login with a success toast', async () => {
    const clearBiometric = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ clearBiometricSession: clearBiometric });
    const screen = wrap(<ResetPasswordScreen />);
    fill(screen);

    await act(async () => {
      fireEvent.press(screen.getByText('Reset Password'));
    });

    expect(resetPw).toHaveBeenCalledWith({
      email: 'ana@example.com',
      code: '123456',
      password: 'Errand#2026',
      password_confirmation: 'Errand#2026',
    });
    expect(mockRouter.replace).toHaveBeenCalledWith('/(auth)/login');
    expect(clearBiometric).toHaveBeenCalled();
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
      'Password updated. Log in with your new password.',
    );
  });

  it('holds the same password rules as sign-up', async () => {
    const screen = wrap(<ResetPasswordScreen />);
    fill(screen, 'weakpass', 'weakpass');
    await act(async () => {
      fireEvent.press(screen.getByText('Reset Password'));
    });
    expect(resetPw).not.toHaveBeenCalled();
    expect(screen.getByText('Must contain an uppercase letter')).toBeTruthy();
  });

  it('puts a wrong code back on the code cells and stays put', async () => {
    resetPw.mockRejectedValue({ status: 422, message: 'That code is wrong or has expired.', errors: { code: ['That code is wrong or has expired.'] } });
    const screen = wrap(<ResetPasswordScreen />);
    fill(screen);
    await act(async () => {
      fireEvent.press(screen.getByText('Reset Password'));
    });
    await waitFor(() => expect(screen.getByText('That code is wrong or has expired.')).toBeTruthy());
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('will not submit without all six digits', async () => {
    const screen = wrap(<ResetPasswordScreen />);
    fireEvent.changeText(screen.getByLabelText('New Password'), 'Errand#2026');
    fireEvent.changeText(screen.getByLabelText('Confirm New Password'), 'Errand#2026');
    await act(async () => {
      fireEvent.press(screen.getByText('Reset Password'));
    });
    expect(resetPw).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the 6-digit code from the email.')).toBeTruthy();
  });
});

describe('copy honesty', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');

  it('no auth copy promises a reset link', () => {
    for (const rel of ['app/(auth)/forgot-password.tsx', 'app/(auth)/reset-password.tsx', 'constants/copy.ts']) {
      expect(read(rel)).not.toMatch(/reset link|Resend link|Reset Link/i);
    }
  });

  it('sign-up no longer promises a "verify later" that did not exist — it points to Profile', () => {
    const register = read('app/(auth)/register.tsx');
    expect(register).not.toMatch(/verify later/i);
    expect(register).toMatch(/verify your email any time from Profile/);
  });
});
