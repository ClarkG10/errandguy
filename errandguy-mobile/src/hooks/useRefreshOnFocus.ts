import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Refetch data when a screen regains focus, but skip the call when the most
 * recent refresh happened within `minIntervalMs` (default 10s). This prevents
 * tab switches and back-navigation from firing a fresh round of API calls
 * every time, which was a major source of perceived sluggishness.
 *
 * Also skips the very first focus event \u2014 the screen's own `useEffect` will
 * already fetch on mount, so the initial focus would otherwise duplicate it.
 *
 * Pass `0` to disable throttling (legacy behaviour).
 */
export function useRefreshOnFocus(refetch: () => void, minIntervalMs = 10_000) {
  const lastRunRef = useRef(0);
  const skipNextRef = useRef(true);

  useFocusEffect(
    useCallback(() => {
      // Skip the initial focus that fires alongside the mount effect.
      if (skipNextRef.current) {
        skipNextRef.current = false;
        lastRunRef.current = Date.now();
        return;
      }
      const now = Date.now();
      if (minIntervalMs > 0 && now - lastRunRef.current < minIntervalMs) {
        return;
      }
      lastRunRef.current = now;
      refetch();
    }, [refetch, minIntervalMs]),
  );
}
