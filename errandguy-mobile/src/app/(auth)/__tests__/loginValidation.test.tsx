import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import LoginScreen from '../login';
import { useToastStore } from '../../../stores/toastStore';

/**
 * Pattern 9 on the sign-in screen: the CTA stays disabled — saying what's
 * missing — until the form is valid, field errors sit under their field and
 * say how to fix it, and wrong credentials land under the password instead of
 * a toast at the screen edge.
 */

const mockLogin = jest.fn();
jest.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ login: mockLogin }) }));
jest.mock('../../../hooks/useBiometricUnlock', () => ({
  useBiometricUnlock: () => ({
    available: false,
    authenticate: jest.fn(),
    biometricLabel: 'Face ID',
    biometricIcon: () => null,
  }),
}));
jest.mock('../../../services/preload.service', () => ({ preloadCoreImages: () => Promise.resolve() }));
jest.mock('../../../components/ui/Wordmark', () => ({ Wordmark: () => null }));
jest.mock('../../../components/ui/LogoutSplash', () => ({ LogoutSplash: () => null }));

const wrap = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}
    >
      <LoginScreen />
    </SafeAreaProvider>,
  );

const logInButton = (screen: ReturnType<typeof wrap>) =>
  screen.getAllByRole('button').find((b) => b.props.accessibilityLabel === 'Log in')!;

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true });
  useToastStore.setState({ toasts: [] });
});

describe('login form validation', () => {
  it('keeps Log in disabled, saying what is missing, until both fields pass', async () => {
    const screen = wrap();
    expect(logInButton(screen).props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    expect(screen.getByText('Enter your phone number or email')).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Phone or email'), '0917123');
    });
    expect(screen.getByText('Add 4 more digits — use 11, like 0917 123 4567')).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Phone or email'), '09180000200');
    });
    expect(screen.getByText('Enter your password')).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Password'), 'Password1!');
    });
    expect(logInButton(screen).props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
  });

  it('flags a half-typed email under the field, with the fix', async () => {
    const screen = wrap();
    const field = screen.getByLabelText('Phone or email');
    await act(async () => {
      fireEvent.changeText(field, 'dalauta@gmail');
      fireEvent(field, 'blur');
    });
    await waitFor(() => expect(screen.getAllByText('Add a domain, like name@gmail.com').length).toBeGreaterThan(0));
  });

  it('puts wrong credentials under the password, not in a toast', async () => {
    mockLogin.mockRejectedValue({
      status: 422,
      message: 'The provided credentials are incorrect.',
      errors: { credentials: ['The provided credentials are incorrect.'] },
    });
    const screen = wrap();
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Phone or email'), '09180000200');
      fireEvent.changeText(screen.getByLabelText('Password'), 'WrongPass1!');
    });
    await act(async () => {
      fireEvent.press(logInButton(screen));
    });
    await waitFor(() =>
      expect(
        screen.getByText("That phone/email and password don't match. Check both, or tap Forgot password."),
      ).toBeTruthy(),
    );
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
