import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useNetworkStore } from '../stores/networkStore';

export interface SmartPollingOptions {
  /** Base tick interval in ms. */
  interval: number;
  /** When false, polling is off entirely (e.g. booking not active). */
  enabled?: boolean;
  /** Run one tick immediately on start / resume. Default true. */
  runOnMount?: boolean;
  /** Pause while offline and resume (with an immediate tick) on reconnect.
   *  Default true. */
  pauseWhenOffline?: boolean;
  /** Grow the interval exponentially after a failed tick so a struggling
   *  backend isn't hammered; a success resets to the base. Default true. */
  backoffOnError?: boolean;
  /** Upper bound for the backed-off interval. Default interval × 8. */
  maxInterval?: number;
}

/**
 * Foreground- and connectivity-aware polling with failure backoff.
 *
 * Why not a plain setInterval / useForegroundInterval:
 *   • Pauses while the app is backgrounded (battery/cellular) AND while
 *     offline (pointless requests), auto-resuming with an immediate tick
 *     when the app returns to the foreground or connectivity is regained.
 *   • The callback may return a Promise. A rejected/throwing tick grows the
 *     delay exponentially (2×, capped at maxInterval); a successful tick
 *     snaps it back to the base interval. This is the "back off after
 *     repeated failures" the fetch strategy calls for.
 *   • Recursive setTimeout (not setInterval) so the delay can change per
 *     tick, and an in-flight tick can never overlap the next one.
 *
 * Pair it with `enabled` to express intent, e.g. poll only while a booking
 * is active, only while a chat is open, only while a runner is online.
 */
export function useSmartPolling(
  callback: () => void | Promise<unknown>,
  {
    interval,
    enabled = true,
    runOnMount = true,
    pauseWhenOffline = true,
    backoffOnError = true,
    maxInterval,
  }: SmartPollingOptions,
) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  const isOffline = useNetworkStore((s) => s.isOffline);
  const gatedOffline = pauseWhenOffline && isOffline;
  const cap = maxInterval ?? interval * 8;

  useEffect(() => {
    if (!enabled || gatedOffline) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let currentDelay = interval;
    let running = false;

    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = setTimeout(tick, delay);
    };

    const tick = async () => {
      if (cancelled || running) return;
      running = true;
      try {
        await cbRef.current();
        currentDelay = interval; // success → reset cadence
      } catch {
        if (backoffOnError) currentDelay = Math.min(currentDelay * 2, cap);
      } finally {
        running = false;
        schedule(currentDelay);
      }
    };

    const startInForeground = () => {
      if (AppState.currentState !== 'active') return;
      if (runOnMount) tick();
      else schedule(currentDelay);
    };

    startInForeground();

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        // Resume: reset cadence + tick immediately so the screen shows fresh
        // data the moment the user comes back.
        clear();
        currentDelay = interval;
        tick();
      } else {
        clear();
      }
    });

    return () => {
      cancelled = true;
      clear();
      sub.remove();
    };
  }, [interval, enabled, gatedOffline, runOnMount, backoffOnError, cap]);
}
