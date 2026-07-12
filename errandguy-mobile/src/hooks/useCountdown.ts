import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * Wall-clock countdown.
 *
 * Deadline-based rather than tick-decremented: JS timers freeze while the
 * app is backgrounded (which is exactly what users do on the OTP screen —
 * they switch to Messages to read the code), so a naive `seconds - 1`
 * interval under-counts elapsed time and holds the resend gate longer than
 * the real policy. Here every tick — and an AppState 'active' listener —
 * recomputes remaining time from `Date.now()` against a stored deadline,
 * so returning to the app snaps the display to true remaining time.
 *
 * Public API is unchanged: { seconds, isRunning, isExpired, start, stop,
 * reset, formatted }.
 */
export function useCountdown(initialSeconds: number, autoStart = false) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const [isRunning, setIsRunning] = useState(autoStart);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Epoch ms at which the countdown hits zero. Null while stopped.
  const deadlineRef = useRef<number | null>(
    autoStart ? Date.now() + initialSeconds * 1000 : null,
  );
  // Remaining seconds while paused — the value start() resumes from.
  const remainingRef = useRef(initialSeconds);

  const computeRemaining = useCallback(() => {
    if (deadlineRef.current == null) return remainingRef.current;
    return Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000));
  }, []);

  const start = useCallback(() => {
    if (deadlineRef.current == null) {
      deadlineRef.current = Date.now() + remainingRef.current * 1000;
    }
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => {
    remainingRef.current = computeRemaining();
    deadlineRef.current = null;
    setIsRunning(false);
  }, [computeRemaining]);

  const reset = useCallback(
    (newSeconds?: number) => {
      const next = newSeconds ?? initialSeconds;
      remainingRef.current = next;
      deadlineRef.current = null;
      setSeconds(next);
      setIsRunning(false);
    },
    [initialSeconds],
  );

  useEffect(() => {
    if (!isRunning) return;

    const tick = () => {
      const remaining = computeRemaining();
      setSeconds(remaining);
      if (remaining <= 0) {
        remainingRef.current = 0;
        deadlineRef.current = null;
        setIsRunning(false);
      }
    };

    tick(); // sync immediately (also covers a resume after start())
    intervalRef.current = setInterval(tick, 1000);

    // Recompute the instant the app foregrounds — the interval was frozen
    // the whole time the user was reading their SMS.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      sub.remove();
    };
  }, [isRunning, computeRemaining]);

  return {
    seconds,
    isRunning,
    isExpired: seconds === 0,
    start,
    stop,
    reset,
    formatted: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
  };
}
