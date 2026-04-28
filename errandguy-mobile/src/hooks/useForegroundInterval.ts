import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

/**
 * setInterval that automatically pauses while the app is backgrounded and
 * resumes (with an immediate run) when it returns to the foreground. Use this
 * for any periodic polling so we don't waste battery + cellular when the
 * screen isn't visible.
 *
 * @param callback - function invoked on each tick (and on foreground resume)
 * @param ms       - tick interval in milliseconds
 * @param enabled  - when false, no interval is started
 * @param runOnMount - whether to invoke `callback` immediately on mount (default true)
 */
export function useForegroundInterval(
  callback: () => void,
  ms: number,
  enabled: boolean = true,
  runOnMount: boolean = true,
) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => cbRef.current(), ms);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    if (runOnMount) cbRef.current();
    if (AppState.currentState === 'active') start();

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        cbRef.current(); // refresh immediately on resume
        start();
      } else {
        stop();
      }
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [ms, enabled, runOnMount]);
}
