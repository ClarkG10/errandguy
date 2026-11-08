import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EditProfileModal } from '../EditProfileModal';
import { useAuthStore } from '../../../stores/authStore';
import { userService } from '../../../services/user.service';
import { compressProofImage } from '../../../utils/proofImage';
import type { User } from '../../../types';

/**
 * The customer's own profile sheet: they could never change their phone number
 * here (runners could), and a new email kept the green "verified" tick until
 * the next refresh even though the server had already cleared it.
 */

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('../../../services/user.service', () => ({
  userService: { updateProfile: jest.fn(), uploadAvatar: jest.fn() },
}));

// The photo picker, reduced to "the customer picked this file".
jest.mock('../../ui/ImagePickerModal', () => {
  const { Pressable, Text } = require('react-native');
  return {
    ImagePickerModal: ({ visible, onConfirm }: { visible: boolean; onConfirm: (uri: string) => void }) =>
      visible ? (
        <Pressable onPress={() => onConfirm('file:///camera/IMG_4000x3000.jpg')}>
          <Text>Use this photo</Text>
        </Pressable>
      ) : null,
  };
});
jest.mock('../../../utils/proofImage', () => ({
  compressProofImage: jest.fn(async () => 'file:///cache/avatar-1024.jpg'),
}));

const mockUpdate = userService.updateProfile as jest.Mock;

const USER = {
  id: 'c1',
  full_name: 'Rina Cruz',
  email: 'rina@example.com',
  email_verified: true,
  phone: '+639171234567',
  phone_verified: true,
} as User;

const renderSheet = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <EditProfileModal visible onClose={jest.fn()} />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ user: { ...USER }, role: 'customer', isAuthenticated: true });
  mockUpdate.mockResolvedValue({ data: { data: USER } });
});

describe('EditProfileModal', () => {
  it('lets a customer change their phone, sent in the shape the server stores', async () => {
    const screen = renderSheet();

    fireEvent.changeText(screen.getByLabelText('Phone number (optional)'), '0918 555 1234');
    await act(async () => {
      fireEvent.press(screen.getByText('Save changes'));
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+639185551234', full_name: 'Rina Cruz' }),
    );
    // The new number is unverified until confirmed again.
    expect(useAuthStore.getState().user?.phone).toBe('+639185551234');
    expect(useAuthStore.getState().user?.phone_verified).toBe(false);
  });

  it('checks the number the same way the runner screen does', async () => {
    const screen = renderSheet();

    fireEvent.changeText(screen.getByLabelText('Phone number (optional)'), '12345');
    await act(async () => {
      fireEvent.press(screen.getByText('Save changes'));
    });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid PH mobile number, e.g. 0917 123 4567')).toBeTruthy();
  });

  it('drops the "verified" tick the moment the email changes', async () => {
    const screen = renderSheet();

    fireEvent.changeText(screen.getByLabelText('Email'), 'new@example.com');
    await act(async () => {
      fireEvent.press(screen.getByText('Save changes'));
    });

    expect(useAuthStore.getState().user?.email).toBe('new@example.com');
    expect(useAuthStore.getState().user?.email_verified).toBe(false);
    // The phone wasn't touched, so neither is its badge.
    expect(useAuthStore.getState().user?.phone_verified).toBe(true);
  });

  it('puts the old details and badges back if the server refuses', async () => {
    mockUpdate.mockRejectedValue({
      status: 422,
      kind: 'validation',
      message: 'The email has already been taken.',
    });
    const screen = renderSheet();

    fireEvent.changeText(screen.getByLabelText('Email'), 'taken@example.com');
    await act(async () => {
      fireEvent.press(screen.getByText('Save changes'));
    });

    expect(useAuthStore.getState().user?.email).toBe('rina@example.com');
    expect(useAuthStore.getState().user?.email_verified).toBe(true);
  });

  it('shrinks a new profile photo before uploading it (the server takes 2 MB at most)', async () => {
    (userService.uploadAvatar as jest.Mock).mockResolvedValue({
      data: { data: { avatar_url: 'https://cdn.example.com/a.jpg' } },
    });
    // (jest's FormData isn't React Native's, so watch what goes into it.)
    const append = jest.spyOn(FormData.prototype, 'append');
    const screen = renderSheet();

    fireEvent.press(screen.getByLabelText('Change profile photo'));
    await act(async () => {
      fireEvent.press(screen.getByText('Use this photo'));
    });

    expect(compressProofImage).toHaveBeenCalledWith('file:///camera/IMG_4000x3000.jpg', {
      maxEdge: 1024,
    });
    expect(append).toHaveBeenCalledWith(
      'avatar',
      expect.objectContaining({ uri: 'file:///cache/avatar-1024.jpg', type: 'image/jpeg' }),
    );
    expect(userService.uploadAvatar).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user?.avatar_url).toBe('https://cdn.example.com/a.jpg');
    append.mockRestore();
  });
});
