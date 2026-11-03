import React from 'react';
import { SectionList } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RunnerNotificationsScreen from '../notifications';
import { notificationService } from '../../../services/notification.service';
import { useAuthStore } from '../../../stores/authStore';
import { useNotificationStore } from '../../../stores/notificationStore';
import type { AppNotification, User } from '../../../types';

/**
 * A failed next page of the runner's inbox used to leave nothing behind — no
 * footer, no retry — and the list simply stopped. It now says so and offers a
 * retry, and waits for that tap instead of re-firing on every scroll (the same
 * footer the errand history uses).
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));
jest.mock('../../../services/notification.service', () => ({
  notificationService: {
    getNotifications: jest.fn(),
    getUnreadCount: jest.fn(() => Promise.resolve({ data: { data: { count: 0 } } })),
  },
}));
jest.mock('../../../components/ui/Illustration', () => ({ Illustration: () => null }));
// The swipe-to-archive row isn't under test; its gesture needs a native runtime.
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const r: typeof React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: r.forwardRef(({ children }: { children: React.ReactNode }, _ref) => (
      <View>{children}</View>
    )),
  };
});

// Runs the fetcher once, without the AsyncStorage layer.
jest.mock('../../../hooks/useQuery', () => {
  const r: typeof React = require('react');
  return {
    useQuery: (_key: unknown, fetcher: () => Promise<unknown>) => {
      const [data, setData] = r.useState<unknown>(undefined);
      const [error, setError] = r.useState<unknown>(null);
      const run = r.useCallback(async () => {
        try {
          setData(await fetcher());
          setError(null);
        } catch (e) {
          setError(e);
        }
      }, []);
      r.useEffect(() => {
        void run();
      }, [run]);
      return {
        data: data ?? null,
        loading: data === undefined && error == null,
        error,
        refresh: run,
        revalidate: run,
        isStale: false,
        updatedAt: null,
        mutate: jest.fn(),
      };
    },
    invalidateQuery: jest.fn(),
  };
});

const getNotifications = notificationService.getNotifications as jest.Mock;

const notif = (id: string): AppNotification =>
  ({
    id,
    type: 'booking_update',
    title: `Title ${id}`,
    body: `Body ${id}`,
    data: {},
    is_read: true,
    read_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }) as unknown as AppNotification;

const page = (from: number, count: number, lastPage: number) => ({
  data: {
    data: Array.from({ length: count }, (_, i) => notif(`n${from + i}`)),
    meta: { last_page: lastPage },
  },
});

const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <RunnerNotificationsScreen />
    </SafeAreaProvider>,
  );

const reachEnd = async (screen: ReturnType<typeof renderScreen>) => {
  await act(async () => {
    screen.UNSAFE_getByType(SectionList).props.onEndReached({ distanceFromEnd: 0 });
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    user: { id: 'r1' } as unknown as User,
    role: 'runner',
    isAuthenticated: true,
  });
  useNotificationStore.setState({ notifications: [] });
});

it('shows a retry footer when the next page fails, and waits for the tap', async () => {
  getNotifications
    .mockResolvedValueOnce(page(1, 20, 3))
    .mockRejectedValueOnce({ status: 0, message: 'Network error.', errors: {}, kind: 'offline' });
  const screen = renderScreen();
  await act(async () => {});

  await reachEnd(screen);

  expect(screen.getByText("Couldn't load more · Tap to retry")).toBeTruthy();
  // Scrolling again must not re-fire the failing request.
  await reachEnd(screen);
  expect(getNotifications).toHaveBeenCalledTimes(2);

  getNotifications.mockResolvedValueOnce(page(21, 20, 3));
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Retry loading more notifications'));
  });

  expect(getNotifications).toHaveBeenCalledTimes(3);
  expect(getNotifications).toHaveBeenLastCalledWith({ page: 2, per_page: 20 });
  expect(screen.queryByText("Couldn't load more · Tap to retry")).toBeNull();
  expect(useNotificationStore.getState().notifications).toHaveLength(40);
});
