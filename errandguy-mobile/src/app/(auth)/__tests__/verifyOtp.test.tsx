import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import VerifyOTPScreen from '../verify-otp';
import { authService } from '../../../services/auth.service';
import { userService } from '../../../services/user.service';
import { useAuthStore } from '../../../stores/authStore';
import { useToastStore } from '../../../stores/toastStore';
import type { User } from '../../../types';

/**
 * The email code right after sign-up. "Change" used to go "back" — to Log in,
 * and from there to Home with the mistyped address still on the account. The
 * account already exists and is signed in, so the address is now corrected
 * right here and the code re-sent to it.
 */

jest.mock('../../../services/auth.service', () => ({
  authService: { sendOTP: jest.fn(), verifyOTP: jest.fn() },
}));
jest.mock('../../../services/user.service', () => ({
  userService: { updateProfile: jest.fn() },
}));
jest.mock('../../../components/ui/Illustration', () => ({ Illustration: () => null }));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
const sendOTP = authService.sendOTP as jest.Mock;
const verifyOTP = authService.verifyOTP as jest.Mock;
const updateProfile = userService.updateProfile as jest.Mock;

const wrap = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}
    >
      <VerifyOTPScreen />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue(mockRouter);
  (useLocalSearchParams as jest.Mock).mockReturnValue({
    email: 'juan@gmial.com',
    purpose: 'register-verify',
  });
  useAuthStore.setState({
    user: { id: 'u1', email: 'juan@gmial.com' } as User,
    isAuthenticated: true,
  });
  useToastStore.setState({ toasts: [] });
  sendOTP.mockResolvedValue({ data: {} });
  verifyOTP.mockResolvedValue({ data: {} });
  updateProfile.mockResolvedValue({ data: { data: { id: 'u1', email: 'juan@gmail.com' } } });
});

describe('verify email after sign-up', () => {
  it('says the email can take a minute and to check spam', () => {
    const screen = wrap();
    expect(screen.getByText(/check your spam folder too/)).toBeTruthy();
  });

  it('offers Resend after two minutes, not five, and says each code replaces the last', () => {
    // Long enough for the first email to land: a resend kills the code still
    // on its way, and the server allows only 3 new codes an hour.
    const screen = wrap();
    expect(screen.getByText('2:00')).toBeTruthy();
    expect(screen.getByText('A new code replaces the last one. You can ask for 3 an hour.')).toBeTruthy();
  });

  it('"Change" corrects the email in place and sends the code to the new address', async () => {
    const screen = wrap();
    fireEvent.press(screen.getByLabelText('Change email address'));
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByLabelText('Email address'), 'juan@gmail.com');
    await act(async () => {
      fireEvent.press(screen.getByText('Send code to this email'));
    });

    expect(updateProfile).toHaveBeenCalledWith({ email: 'juan@gmail.com' });
    expect(sendOTP).toHaveBeenCalledWith({ email: 'juan@gmail.com' });
    expect(useAuthStore.getState().user?.email).toBe('juan@gmail.com');
    expect(screen.getByText('ju***@gmail.com')).toBeTruthy();

    // The code is then checked against the NEW address.
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Digit 1 of 6'), '123456');
    });
    expect(verifyOTP).toHaveBeenCalledWith({ email: 'juan@gmail.com', code: '123456' });
  });

  it('shows the server’s reason inline when the new address is taken', async () => {
    updateProfile.mockRejectedValue({ status: 422, errors: { email: ['The email has already been taken.'] } });
    const screen = wrap();
    fireEvent.press(screen.getByLabelText('Change email address'));
    fireEvent.changeText(screen.getByLabelText('Email address'), 'taken@example.com');
    await act(async () => {
      fireEvent.press(screen.getByText('Send code to this email'));
    });

    expect(screen.getByText('The email has already been taken.')).toBeTruthy();
    expect(sendOTP).not.toHaveBeenCalled();
  });

  it('rejects an address that isn’t one before calling the server', async () => {
    const screen = wrap();
    fireEvent.press(screen.getByLabelText('Change email address'));
    fireEvent.changeText(screen.getByLabelText('Email address'), 'juan@');
    await act(async () => {
      fireEvent.press(screen.getByText('Send code to this email'));
    });
    expect(screen.getByText('Add a domain after the @, like name@gmail.com')).toBeTruthy();
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
