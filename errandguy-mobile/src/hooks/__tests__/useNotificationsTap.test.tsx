/**
 * Push taps.
 *
 * A tap that launches a killed app arrives while auth is still loading (no
 * user, no role). It used to be routed right then — a runner's tap took the
 * customer branch and was bounced out. It is now held until the app says it is
 * ready, then routed with the real role. Opening a push also reads its inbox
 * row, so the Alerts badge has to drop.
 */
import React from 'react';
import { render, act } from '@testing-library/react-native';
import { useNotifications } from '../useNotifications';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

let mockLastResponse: unknown = null;
let mockLiveTap: ((response: unknown) => void) | null = null;
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn((cb: (r: unknown) => void) => {
    mockLiveTap = cb;
    return { remove: jest.fn() };
  }),
  getLastNotificationResponse: jest.fn(() => mockLastResponse),
  clearLastNotificationResponse: jest.fn(),
}));
jest.mock('expo-device', () => ({ isDevice: false }));
jest.mock('../../services/sosActive', () => ({ noteSosNotification: jest.fn(() => Promise.resolve()) }));
jest.mock('../../services/user.service', () => ({ userService: { updateFCMToken: jest.fn() } }));

const mockMarkAsRead = jest.fn();
const mockGetUnreadCount = jest.fn();
jest.mock('../../services/notification.service', () => ({
  notificationService: {
    markAsRead: (...a: unknown[]) => mockMarkAsRead(...a),
    getUnreadCount: (...a: unknown[]) => mockGetUnreadCount(...a),
  },
}));

const tap = (id: string, data: Record<string, unknown>) => ({
  notification: { request: { identifier: id, content: { data } } },
});

function Harness({ routeReady }: { routeReady: boolean }) {
  useNotifications(false, { routeReady });
  return null;
}

const flush = () => act(async () => {});

beforeEach(() => {
  jest.clearAllMocks();
  mockLastResponse = null;
  mockLiveTap = null;
  mockMarkAsRead.mockResolvedValue({ data: {} });
  mockGetUnreadCount.mockResolvedValue({ data: { data: { unread_count: 0 } } });
  useAuthStore.setState({ isLoading: true, role: null, isAuthenticated: false, user: null });
  useNotificationStore.setState({ notifications: [], unreadCount: 0 });
});

describe('a tap that launched a killed app', () => {
  it('is held while auth loads, then routed with the real role', async () => {
    mockLastResponse = tap('n-1', { type: 'booking_update', booking_id: 'bk-1' });
    const screen = render(<Harness routeReady={false} />);
    await flush();
    expect(mockPush).not.toHaveBeenCalled();

    // Auth hydrates: a runner, and their navigator is up.
    useAuthStore.setState({ isLoading: false, role: 'runner', isAuthenticated: true });
    screen.rerender(<Harness routeReady />);
    await flush();

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/(runner)/errand/bk-1');
  });

  it('is also held when the OS re-delivers it through the live listener', async () => {
    const screen = render(<Harness routeReady={false} />);
    await flush();
    act(() => mockLiveTap?.(tap('n-2', { type: 'booking_update', booking_id: 'bk-2' })));
    expect(mockPush).not.toHaveBeenCalled();

    useAuthStore.setState({ isLoading: false, role: 'customer', isAuthenticated: true });
    screen.rerender(<Harness routeReady />);
    await flush();

    expect(mockPush).toHaveBeenCalledWith('/(customer)/tracking/bk-2');
  });

  it('is routed once even if the buffered read and the listener both deliver it', async () => {
    const response = tap('n-3', { type: 'booking_update', booking_id: 'bk-3' });
    mockLastResponse = response;
    const screen = render(<Harness routeReady={false} />);
    await flush();
    act(() => mockLiveTap?.(response));

    useAuthStore.setState({ isLoading: false, role: 'runner', isAuthenticated: true });
    screen.rerender(<Harness routeReady />);
    await flush();
    act(() => mockLiveTap?.(response));

    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe('a tap while the app is already running', () => {
  it('routes straight away, as before', async () => {
    useAuthStore.setState({ isLoading: false, role: 'runner', isAuthenticated: true });
    render(<Harness routeReady />);
    await flush();

    act(() => mockLiveTap?.(tap('n-4', { type: 'booking_update', booking_id: 'bk-4' })));

    expect(mockPush).toHaveBeenCalledWith('/(runner)/errand/bk-4');
  });
});

describe('the inbox row behind a tapped push', () => {
  const ready = async () => {
    useAuthStore.setState({ isLoading: false, role: 'customer', isAuthenticated: true });
    render(<Harness routeReady />);
    await flush();
  };

  it('is marked read, and the badge drops', async () => {
    useNotificationStore.setState({
      notifications: [{ id: 'row-1', is_read: false } as any],
      unreadCount: 1,
    });
    await ready();

    act(() =>
      mockLiveTap?.(tap('n-5', { type: 'booking_update', booking_id: 'bk-5', notification_id: 'row-1' })),
    );
    await flush();

    expect(mockMarkAsRead).toHaveBeenCalledWith('row-1');
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  it('re-reads the server count when the row is not loaded yet', async () => {
    useNotificationStore.setState({ notifications: [], unreadCount: 4 });
    mockGetUnreadCount.mockResolvedValue({ data: { data: { unread_count: 3 } } });
    await ready();

    act(() =>
      mockLiveTap?.(tap('n-6', { type: 'booking_update', booking_id: 'bk-6', notification_id: 'row-9' })),
    );
    await flush();

    expect(mockMarkAsRead).toHaveBeenCalledWith('row-9');
    expect(useNotificationStore.getState().unreadCount).toBe(3);
  });

  it('a push with no notification_id marks nothing', async () => {
    await ready();
    act(() => mockLiveTap?.(tap('n-7', { type: 'booking_update', booking_id: 'bk-7' })));
    await flush();
    expect(mockMarkAsRead).not.toHaveBeenCalled();
  });

  it('a failed mark leaves the badge as it was and throws nothing', async () => {
    useNotificationStore.setState({ notifications: [], unreadCount: 2 });
    mockMarkAsRead.mockRejectedValue({ status: 0, kind: 'offline' });
    await ready();

    act(() =>
      mockLiveTap?.(tap('n-8', { type: 'booking_update', booking_id: 'bk-8', notification_id: 'row-2' })),
    );
    await flush();

    expect(useNotificationStore.getState().unreadCount).toBe(2);
    expect(mockGetUnreadCount).not.toHaveBeenCalled();
  });
});
