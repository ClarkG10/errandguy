/**
 * Chat's fallback poll follows the realtime channel's health.
 *
 * It used to poll every 8s regardless — ~450 requests an hour per open chat —
 * even while the Reverb channel was subscribed and already pushing every
 * message. It now relaxes to 30s while the channel is live and drops straight
 * back to 8s the moment it isn't.
 */
import { act, renderHook } from '@testing-library/react-native';

let mockHealth: ((live: boolean) => void) | null = null;
const mockStopWatching = jest.fn();
jest.mock('../../services/echo', () => {
  const channel = {
    listen: jest.fn(),
    stopListening: jest.fn(),
    listenForWhisper: jest.fn(),
    stopListeningForWhisper: jest.fn(),
    whisper: jest.fn(),
  };
  return {
    echo: { private: () => channel },
    retainChannel: jest.fn(),
    releaseChannel: jest.fn(),
    watchChannelHealth: (_ch: unknown, onChange: (live: boolean) => void) => {
      mockHealth = onChange;
      return mockStopWatching;
    },
  };
});

const mockPollOpts: Array<{ interval: number }> = [];
jest.mock('../useSmartPolling', () => ({
  useSmartPolling: (_cb: unknown, opts: { interval: number }) => {
    mockPollOpts.push(opts);
  },
}));

jest.mock('../../services/chat.service', () => ({
  chatService: {
    getMessages: jest.fn(() => Promise.resolve({ data: { data: [], meta: {} } })),
    markAsRead: jest.fn(() => Promise.resolve()),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useChat } = require('../useChat') as typeof import('../useChat');

const lastInterval = () => mockPollOpts.at(-1)?.interval;

beforeEach(() => {
  mockPollOpts.length = 0;
  mockHealth = null;
  mockStopWatching.mockClear();
});

it('polls tightly until the chat channel is live, then relaxes', () => {
  renderHook(() => useChat('bk-1'));
  expect(lastInterval()).toBe(8_000);

  act(() => mockHealth?.(true));
  expect(lastInterval()).toBe(30_000);

  // Socket dropped / auth failed: the poll is the only feed again.
  act(() => mockHealth?.(false));
  expect(lastInterval()).toBe(8_000);
});

it('stops watching the channel when the chat closes', () => {
  const { unmount } = renderHook(() => useChat('bk-1'));
  unmount();
  expect(mockStopWatching).toHaveBeenCalledTimes(1);
});
