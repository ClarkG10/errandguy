import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import EditProfileScreen from '../edit-profile';
import { useAuthStore } from '../../../../stores/authStore';
import { userService } from '../../../../services/user.service';
import { toast } from '../../../../stores/toastStore';
import type { User } from '../../../../types';

/**
 * Pattern 9 on the runner's Edit profile: each problem shows under its own
 * field and says how to fix it; a server 422 lands there too, not in a toast.
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: () => true }),
  useNavigation: () => ({ addListener: () => () => {} }),
}));

jest.mock('../../../../services/user.service', () => ({
  userService: { updateProfile: jest.fn() },
}));

const updateProfile = userService.updateProfile as jest.Mock;

const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <EditProfileScreen />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    user: { id: 'r1', full_name: 'Juan Dela Cruz', phone: '', email: '' } as unknown as User,
  });
});

describe('edit profile — field errors', () => {
  it('says why Save is off before anything changes', () => {
    const screen = renderScreen();
    expect(screen.getByText('No changes to save yet.')).toBeTruthy();
  });

  it('explains a half-typed email on blur, under the field', () => {
    const screen = renderScreen();
    const email = screen.getByPlaceholderText('you@example.com');
    fireEvent.changeText(email, 'juan@gmail');
    fireEvent(email, 'blur');
    expect(screen.getByText('Add a domain, like name@gmail.com.')).toBeTruthy();
  });

  it('asks for an @ when there is none', () => {
    const screen = renderScreen();
    const email = screen.getByPlaceholderText('you@example.com');
    fireEvent.changeText(email, 'juan.gmail.com');
    fireEvent(email, 'blur');
    expect(screen.getByText('Add an @, like name@gmail.com.')).toBeTruthy();
  });

  it('names the phone format the server takes', () => {
    const screen = renderScreen();
    const phone = screen.getByPlaceholderText('09XX XXX XXXX');
    fireEvent.changeText(phone, '12345');
    fireEvent(phone, 'blur');
    expect(screen.getByText('Use a PH mobile number, like 0917 123 4567.')).toBeTruthy();
  });

  it('puts a server 422 under the field it names, without a toast', async () => {
    updateProfile.mockRejectedValue({
      status: 422,
      errors: { email: ['This email is already registered.'] },
    });
    const toastError = jest.spyOn(toast, 'error');
    const screen = renderScreen();
    fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), 'taken@gmail.com');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Save changes'));
    });
    expect(screen.getByText('This email is already registered.')).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
    toastError.mockRestore();
  });
});
