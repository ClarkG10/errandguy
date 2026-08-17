import { renderHook, act } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useSmartPolling } from '../useSmartPolling';

/**
 * The poller must PAUSE while the app is backgrounded (its documented contract).
 * The specific bug: if the app went to the background WHILE a tick was in-flight,
 * there was no scheduled timer to clear, and the tick's finally re-armed anyway —
 * looping in the background for the whole session (battery/cellular drain).
 */
describe('useSmartPolling — background pause', () => {
  let changeHandler: ((s: string) => void) | null;

  beforeEach(() => {
    jest.useFakeTimers();
    changeHandler = null;
    (AppState as unknown as { currentState: string }).currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      type: string,
      handler: (s: string) => void,
    ) => {
      if (type === 'change') changeHandler = handler;
      return { remove: jest.fn() };
    }) as unknown as typeof AppState.addEventListener);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not reschedule when the app backgrounds mid-tick', async () => {
    let resolveTick: () => void = () => {};
    const cb = jest.fn(() => new Promise<void>((res) => (resolveTick = res)));

    renderHook(() =>
      useSmartPolling(cb, { interval: 1000, runOnMount: true, pauseWhenOffline: false }),
    );

    // runOnMount → a tick starts; the callback is now IN-FLIGHT (unresolved).
    expect(cb).toHaveBeenCalledTimes(1);

    // Background WHILE that tick is in-flight — the exact bug trigger (no timer
    // to clear, so the old code re-armed in finally).
    await act(async () => {
      changeHandler?.('background');
    });

    // The in-flight tick resolves; its finally must NOT reschedule now.
    await act(async () => {
      resolveTick();
    });

    // Well past the interval, no background tick should fire.
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('resumes with an immediate tick on foreground', async () => {
    const cb = jest.fn(() => Promise.resolve());

    renderHook(() =>
      useSmartPolling(cb, { interval: 1000, runOnMount: true, pauseWhenOffline: false }),
    );

    await act(async () => {}); // initial tick
    expect(cb).toHaveBeenCalledTimes(1);

    await act(async () => changeHandler?.('background'));
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(cb).toHaveBeenCalledTimes(1); // paused

    await act(async () => changeHandler?.('active'));
    expect(cb).toHaveBeenCalledTimes(2); // immediate resume tick
  });
});
