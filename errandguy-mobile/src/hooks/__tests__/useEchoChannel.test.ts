/**
 * useEchoChannel cleanup.
 *
 * Echo's `.subscribed(cb)` / `.error(cb)` wrap the callback in a fresh closure,
 * so the hook could never unbind them: channels are ref-counted and shared (the
 * booking channel outlives any one screen), and every mount left another pair
 * of dead closures bound to it. The hook now binds the Pusher lifecycle events
 * itself and removes everything it added on unmount.
 */
import { act, renderHook } from '@testing-library/react-native';

type Cb = (...args: unknown[]) => void;

const mockChannels = new Map<string, Map<string, Set<Cb>>>();
const mockConnection = {
  state: 'disconnected',
  handlers: new Set<Cb>(),
  bind(_event: string, cb: Cb) {
    this.handlers.add(cb);
  },
  unbind(_event: string, cb: Cb) {
    this.handlers.delete(cb);
  },
};

jest.mock('pusher-js', () => ({ __esModule: true, default: function Pusher() {} }));
jest.mock('laravel-echo', () => ({
  __esModule: true,
  default: class FakeEcho {
    connector = { pusher: { connection: mockConnection } };
    private(name: string) {
      const events = mockChannels.get(name) ?? new Map<string, Set<Cb>>();
      mockChannels.set(name, events);
      return {
        listen(event: string, cb: Cb) {
          const set = events.get(event) ?? new Set<Cb>();
          set.add(cb);
          events.set(event, set);
          return this;
        },
        stopListening(event: string, cb?: Cb) {
          if (cb) events.get(event)?.delete(cb);
          else events.delete(event);
          return this;
        },
      };
    }
    leave() {}
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useEchoChannel } = require('../useEchoChannel') as typeof import('../useEchoChannel');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { retainChannel, releaseChannel } = require('../../services/echo') as typeof import('../../services/echo');

const CHANNEL = 'booking.bk-1';
const fire = (event: string, ...args: unknown[]) =>
  mockChannels.get(CHANNEL)?.get(event)?.forEach((cb) => cb(...args));
/** Every callback still bound on the channel, across all events. */
const boundCount = () =>
  [...(mockChannels.get(CHANNEL)?.values() ?? [])].reduce((n, set) => n + set.size, 0);

beforeEach(() => {
  mockChannels.clear();
  mockConnection.handlers.clear();
  mockConnection.state = 'disconnected';
});

it('reports the subscription coming up and failing', () => {
  const { result } = renderHook(() =>
    useEchoChannel({ channel: CHANNEL, event: 'booking.status', onEvent: () => {} }),
  );
  expect(result.current.isConnected).toBe(false);

  act(() => fire('.pusher:subscription_succeeded', {}));
  expect(result.current.isConnected).toBe(true);

  act(() => fire('.pusher:subscription_error', 403));
  expect(result.current.isConnected).toBe(false);
});

it('delivers the event to the current handler', () => {
  const onEvent = jest.fn();
  renderHook(() => useEchoChannel({ channel: CHANNEL, event: 'booking.status', onEvent }));

  act(() => fire('.booking.status', { status: 'accepted' }));

  expect(onEvent).toHaveBeenCalledWith({ status: 'accepted' });
});

it('removes every listener it added when it unmounts', () => {
  const { unmount } = renderHook(() =>
    useEchoChannel({ channel: CHANNEL, event: 'booking.status', onEvent: () => {} }),
  );
  expect(boundCount()).toBe(3); // event + subscribed + error
  expect(mockConnection.handlers.size).toBe(1);

  unmount();

  expect(boundCount()).toBe(0);
  expect(mockConnection.handlers.size).toBe(0);
});

it('does not pile closures onto a shared channel across remounts', () => {
  // Another screen holds the channel open the whole time.
  retainChannel(CHANNEL);
  try {
    for (let i = 0; i < 5; i++) {
      const { unmount } = renderHook(() =>
        useEchoChannel({ channel: CHANNEL, event: 'booking.status', onEvent: () => {} }),
      );
      unmount();
    }
    expect(boundCount()).toBe(0);
  } finally {
    releaseChannel(CHANNEL);
  }
});
