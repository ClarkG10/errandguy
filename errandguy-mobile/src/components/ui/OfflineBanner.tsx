import React, { useCallback, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloudOff } from 'lucide-react-native';
import api from '../../services/api';
import { useNetworkStore } from '../../stores/networkStore';
import { useQueuedMutationCount } from '../../services/mutationQueue';
import { useForegroundInterval } from '../../hooks/useForegroundInterval';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { LightColors } from '../../constants/colors';

/**
 * Global "You're offline" banner. Mounted once at the app root
 * (alongside ApiActivityBar) — every screen gets it without wiring.
 *
 * Slides down from under the safe-area top when networkStore flips to
 * offline (driven by the api.ts interceptors), and slides away as soon
 * as any request reaches the server again.
 *
 * Auto-recovery: while offline (and in the foreground) it pings the
 * Laravel `/up` health route every ~10s. The ping goes through the
 * shared axios instance, so a successful response clears the offline
 * flag via the normal response interceptor — no special-casing here.
 */
const PING_INTERVAL_MS = 10_000;
const HIDDEN_OFFSET = 140;

// `/up` lives at the web root, not under the `/api/v1` prefix the axios
// instance is configured with — derive the bare origin once at import.
const API_ORIGIN =
  (process.env.EXPO_PUBLIC_API_URL ?? '').match(/^https?:\/\/[^/]+/)?.[0] ??
  null;

function pingHealth() {
  // silent → doesn't blip the ApiActivityBar; noCache/noDedupe → always
  // hits the network so the probe is honest. Success flips the offline
  // flag via the response interceptor; failure re-asserts offline.
  const config = {
    silent: true,
    noCache: true,
    noDedupe: true,
    timeout: 8000,
  } as any;
  const request = API_ORIGIN
    ? api.get('/up', { ...config, baseURL: API_ORIGIN })
    : // Fallback when the origin can't be derived: the unauthenticated
      // app-config endpoint on the normal API prefix.
      api.get('/config/app', config);
  request.catch(() => {});
}

export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const isOffline = useNetworkStore((s) => s.isOffline);
  const reduceMotion = useReducedMotion();
  // Changes made offline are held in the durable mutation queue and replay on
  // reconnect — tell the user their edits aren't lost, just pending.
  const queuedCount = useQueuedMutationCount();

  const translateY = useSharedValue(-HIDDEN_OFFSET);

  useEffect(() => {
    if (isOffline) {
      translateY.value = reduceMotion
        ? 0
        : withSpring(0, { damping: 18, stiffness: 200 });
    } else {
      translateY.value = reduceMotion
        ? -HIDDEN_OFFSET
        : withTiming(-HIDDEN_OFFSET, { duration: 220 });
    }
  }, [isOffline, reduceMotion, translateY]);

  // Foreground-only recovery probe — pauses in the background so we
  // don't burn battery/cellular, resumes with an immediate ping.
  useForegroundInterval(pingHealth, PING_INTERVAL_MS, isOffline, true);

  const handleRetry = useCallback(() => {
    pingHealth();
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      // box-none: the banner never blocks touches on the screen below —
      // only the Retry pill itself is tappable.
      pointerEvents={isOffline ? 'box-none' : 'none'}
      style={[styles.container, animatedStyle]}
      accessibilityElementsHidden={!isOffline}
      importantForAccessibility={isOffline ? 'yes' : 'no-hide-descendants'}
    >
      <View
        style={[styles.banner, { paddingTop: insets.top + 8 }]}
        pointerEvents="box-none"
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
      >
        <CloudOff size={18} color={LightColors.warning} strokeWidth={2} />
        <View style={styles.copy} pointerEvents="none">
          <Text style={styles.title}>You're offline</Text>
          <Text style={styles.subtitle}>
            {queuedCount > 0
              ? `${queuedCount} ${queuedCount === 1 ? 'change' : 'changes'} will sync when you're back`
              : 'Some features may not work.'}
          </Text>
        </View>
        <Pressable
          onPress={handleRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry connection"
          hitSlop={8}
          style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Below the ApiActivityBar (9999) so the progress bar stays visible
    // on top of the banner during the recovery ping.
    zIndex: 9998,
    elevation: 8,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: LightColors.ink,
  },
  copy: {
    flex: 1,
    marginLeft: 10,
  },
  title: {
    fontSize: 13,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textInverse,
    letterSpacing: 0.1,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: 'Quicksand_400Regular',
    color: `${LightColors.textInverse}B3`,
    marginTop: 1,
  },
  retry: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: `${LightColors.textInverse}1F`,
    borderWidth: 1,
    borderColor: `${LightColors.textInverse}33`,
  },
  retryText: {
    fontSize: 12.5,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textInverse,
    letterSpacing: 0.2,
  },
});
