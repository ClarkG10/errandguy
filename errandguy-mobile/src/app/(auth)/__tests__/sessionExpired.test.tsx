import React from 'react';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';
import { useRouter, useSegments } from 'expo-router';
import AuthLayout from '../_layout';
import { useAuthStore } from '../../../stores/authStore';
import { useBookingStore } from '../../../stores/bookingStore';
import { useToastStore } from '../../../stores/toastStore';
import { SIGNED_OUT_REASON } from '../../../services/api';

/**
 * Pattern 8: a 401 sign-out lands on a calm card over the sign-in screen that
 * says the draft is kept — only when there is one. A dead account keeps its
 * server-worded toast.
 */

// The shared expo-router mock has no renderable Stack.
jest.mock('expo-router', () => {
  const Stack = Object.assign(() => null, { Screen: () => null });
  return { useRouter: jest.fn(), useSegments: jest.fn(), Stack };
});

const mockReplace = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), replace: mockReplace, back: jest.fn() });
  (useSegments as jest.Mock).mockReturnValue(['(auth)', 'welcome']);
  useToastStore.setState({ toasts: [] });
});

const draftOf = (draftBooking: Record<string, unknown>) =>
  useBookingStore.setState({ draftBooking, isDraftHydrated: true } as never);

it('shows the signed-out card, mentioning the saved draft', async () => {
  draftOf({ pickup_address: 'SM Megamall', dropoff_address: 'The Grove, Pasig' });
  useAuthStore.setState({ sessionEndedReason: SIGNED_OUT_REASON });
  const screen = render(<AuthLayout />);
  await waitFor(() => expect(screen.getByText('You were signed out')).toBeTruthy());
  expect(screen.getByText('For your security we signed you out. Your errand draft is saved.')).toBeTruthy();
  expect(useToastStore.getState().toasts).toHaveLength(0);
  await act(async () => {
    fireEvent.press(screen.getByText('Sign in and continue'));
  });
  expect(screen.queryByText('You were signed out')).toBeNull();
  // From the welcome screen, signing back in happens on login.
  expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
});

it('says nothing about a draft when there is none', async () => {
  draftOf({});
  useAuthStore.setState({ sessionEndedReason: SIGNED_OUT_REASON });
  const screen = render(<AuthLayout />);
  await waitFor(() => expect(screen.getByText('For your security we signed you out.')).toBeTruthy());
  expect(screen.queryByText(/draft/)).toBeNull();
});

it('keeps the server-worded toast for a dead account', async () => {
  useAuthStore.setState({ sessionEndedReason: 'Your account has been suspended.' });
  const screen = render(<AuthLayout />);
  await act(async () => {});
  expect(screen.queryByText('You were signed out')).toBeNull();
  expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('Your account has been suspended.');
});
