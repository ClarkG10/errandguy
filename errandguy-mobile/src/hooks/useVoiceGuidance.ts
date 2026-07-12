import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MUTE_KEY = '@voice_guidance_muted';

/**
 * Spoken turn-by-turn guidance built on expo-speech. Exposes an
 * imperative `speak(text)` (interrupts any in-flight utterance so a
 * stale instruction never queues behind the current one), a `stop()`,
 * and a `muted` flag persisted in AsyncStorage so the runner's choice
 * survives navigation sessions.
 *
 * `speak` is a no-op while muted, so callers don't need to guard.
 *
 * NOTE: This feature requires a native rebuild (`npx expo prebuild` +
 * pod install / gradle). In Expo Go the native speech module is absent;
 * every call is wrapped so that degrades silently.
 */
export function useVoiceGuidance() {
  const [muted, setMuted] = useState(false);
  // Mirror `muted` into a ref so the stable `speak` callback reads the
  // latest value without being torn down / recreated on every toggle.
  const mutedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(MUTE_KEY)
      .then((v) => {
        if (mounted && v === 'true') {
          setMuted(true);
          mutedRef.current = true;
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const speak = useCallback((text: string) => {
    if (mutedRef.current || !text) return;
    try {
      Speech.stop();
      Speech.speak(text, { language: 'en-US', rate: 1.0, pitch: 1.0 });
    } catch {}
  }, []);

  const stop = useCallback(() => {
    try {
      Speech.stop();
    } catch {}
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;
      if (next) {
        try {
          Speech.stop();
        } catch {}
      }
      AsyncStorage.setItem(MUTE_KEY, next ? 'true' : 'false').catch(() => {});
      return next;
    });
  }, []);

  // Cut off any in-flight speech when the consumer unmounts.
  useEffect(
    () => () => {
      try {
        Speech.stop();
      } catch {}
    },
    [],
  );

  return { muted, speak, stop, toggleMuted };
}
