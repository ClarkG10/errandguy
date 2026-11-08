import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WifiOff } from 'lucide-react-native';
import api from '../../services/api';
import { useNetworkStore } from '../../stores/networkStore';
import { useQueuedMutationCount } from '../../services/mutationQueue';
import { useForegroundInterval } from '../../hooks/useForegroundInterval';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { LightColors } from '../../constants/colors';

/**
 * Global "You're offline" banner (pattern 4). Mounted once at the app root
 * (alongside ApiActivityBar) — every screen gets it without wiring.
 *
 * A warm amber banner with the wifi-off icon — "You're offline. Showing what
 * you had last." — so cached content below it reads as intentional, plus what
 * still works. While a reconnect probe is in flight a small dark
 * "Reconnecting…" pill floats near the bottom, so a Retry tap visibly does
 * something.
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

function pingHealth(): Promise<unknown> {
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
  return request.catch(() => {});
}

/** The pill stays up at least this long, so a fast failure doesn't flicker. */
const RECONNECTING_MIN_MS = 1200;

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

  // A Retry the person tapped is in flight — drives the "Reconnecting…" pill
  // and holds the button. Only theirs: the automatic 10-second probe used to
  // set it too, so on a weak connection Retry was disabled most of the time.
  const [reconnecting, setReconnecting] = useState(false);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
  const autoPing = useCallback(() => {
    void pingHealth();
  }, []);

  // Foreground-only recovery probe — pauses in the background so we
  // don't burn battery/cellular, resumes with an immediate ping. Silent.
  useForegroundInterval(autoPing, PING_INTERVAL_MS, isOffline, true);

  const handleRetry = useCallback(() => {
    const started = Date.now();
    setReconnecting(true);
    pingHealth().finally(() => {
      const wait = Math.max(0, RECONNECTING_MIN_MS - (Date.now() - started));
      setTimeout(() => {
        if (mountedRef.current) setReconnecting(false);
      }, wait);
    });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <>
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
          <WifiOff size={18} color={LightColors.warningDark} strokeWidth={2} />
          <View style={styles.copy} pointerEvents="none">
            <Text style={styles.title}>You're offline. Showing what you had last.</Text>
            <Text style={styles.subtitle}>
              {queuedCount > 0
                ? `${queuedCount} ${queuedCount === 1 ? 'change' : 'changes'} will sync when you're back.`
                : 'You can still read anything you opened before.'}
            </Text>
          </View>
          <Pressable
            onPress={handleRetry}
            disabled={reconnecting}
            accessibilityRole="button"
            accessibilityLabel="Retry connection"
            accessibilityState={{ disabled: reconnecting, busy: reconnecting }}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            className="active:opacity-70"
            style={styles.retry}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </Animated.View>
      {isOffline && reconnecting ? (
        <View
          pointerEvents="none"
          style={[styles.pillWrap, { bottom: insets.bottom + 96 }]}
          accessibilityLiveRegion="polite"
        >
          <View style={styles.pill} accessible accessibilityLabel="Reconnecting">
            <ActivityIndicator size="small" color={LightColors.textInverse} />
            <Text style={styles.pillText}>Reconnecting…</Text>
          </View>
        </View>
      ) : null}
    </>
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
    // Warm amber wash (warning family — a caution, not the brand accent).
    backgroundColor: LightColors.warningLight,
    borderBottomWidth: 1,
    borderBottomColor: `${LightColors.warning}66`,
  },
  copy: {
    flex: 1,
    marginLeft: 10,
  },
  title: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textSecondary,
    marginTop: 1,
  },
  retry: {
    marginLeft: 10,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: LightColors.surface,
    borderWidth: 1,
    borderColor: `${LightColors.warning}80`,
  },
  retryText: {
    fontSize: 12.5,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.warningDark,
    letterSpacing: 0.2,
  },
  pillWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9998,
    elevation: 9,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: `${LightColors.ink}E6`,
  },
  pillText: {
    fontSize: 13,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textInverse,
  },
});
