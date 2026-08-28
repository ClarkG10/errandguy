import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Hold the screen on while a task is genuinely in flight.
 *
 * A runner works a job with the phone on a bar mount: turn-by-turn running,
 * hands on the bars. With the OS auto-lock at its usual 30s the screen sleeps
 * between junctions, so every glance costs a stop, an unlock and a hunt back
 * to the right screen. Same story for the customer walking with the live map
 * open, and for the moment the phone is handed over for a signature.
 *
 * `expo-keep-awake` has shipped with the app all along but was only ever used
 * to RELEASE the lock in a __DEV__ guard (see app/_layout.tsx) — nothing has
 * ever acquired it.
 *
 * Pass `active=false` (a terminal booking, a screen that lost focus) and the
 * tag is released immediately; it is also released on unmount, so a screen
 * that is popped mid-errand can never leak a permanently-lit display.
 *
 * Every call is wrapped: the native module is absent in Expo Go / an
 * out-of-sync dev client, and Android's activate() is known to throw when the
 * activity is being destroyed — which is exactly the teardown path this hook
 * runs on. Keeping the screen awake is a convenience, never a reason to crash
 * a runner mid-job.
 */
export function useKeepAwakeWhile(active: boolean, tag = 'errandguy'): void {
  useEffect(() => {
    if (!active || Platform.OS === 'web') return;

    let released = false;

    try {
      // Fire-and-forget: the promise rejects on the same teardown race the
      // synchronous call throws on, so it needs its own catch.
      const { activateKeepAwakeAsync } = require('expo-keep-awake');
      void activateKeepAwakeAsync(tag)?.catch?.(() => {});
    } catch {
      // Native module unavailable — the screen just dims as it does today.
      return;
    }

    return () => {
      if (released) return;
      released = true;
      try {
        const { deactivateKeepAwake } = require('expo-keep-awake');
        deactivateKeepAwake(tag);
      } catch {
        // Activity already gone; the OS drops the lock with it.
      }
    };
  }, [active, tag]);
}
