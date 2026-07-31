import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ScrollView,
  AppState,
  Linking,
  AccessibilityInfo,
  type ImageSourcePropType,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { Check, CheckCircle, Lock, Settings as SettingsIcon } from 'lucide-react-native';
import { Button } from '../ui/Button';
import { toast } from '../../stores/toastStore';
import { LightColors } from '../../constants/colors';
import { useResponsive } from '../../constants/responsive';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export interface PermissionStatus {
  granted: boolean;
  canAskAgain: boolean;
}

export interface PermissionPrimerProps {
  illustrationSource: ImageSourcePropType;
  title: string;
  /** Concrete benefit bullets — the persuasive core of the primer. */
  reasons: string[];
  /** Position in the two-step permission flow. */
  stepIndex: 1 | 2;
  /** Optional trust line rendered under the reasons with a lock icon. */
  privacyNote?: string;
  /**
   * Reads the current permission status. Return `null` when the underlying
   * native module is unavailable (e.g. expo-contacts in Expo Go) — the
   * primer degrades to a plain Continue button instead of a no-op ask.
   */
  checkStatus: () => Promise<PermissionStatus | null>;
  /** Shows the OS dialog. Same `null` contract as `checkStatus`. */
  requestPermission: () => Promise<PermissionStatus | null>;
  /** Success pill copy, e.g. "Location access enabled". */
  grantedLabel: string;
  /** Blocked banner headline, e.g. "Location is turned off for ErrandGuy". */
  blockedTitle: string;
  /** Blocked banner recovery instructions (platform-specific settings path). */
  blockedBody: string;
  /** Primary CTA label in the ask state, e.g. "Allow Location". */
  allowLabel: string;
  /** Toast shown when the permission request itself throws. */
  requestErrorMessage: string;
  /** Screen-reader hint on the "Not now" skip explaining the consequence. */
  skipHint: string;
  onNext: () => void;
}

/**
 * Shared permission primer — one component behind both the location and
 * contacts screens so the two consecutive steps stay visually and
 * behaviorally locked in sync.
 *
 * Handles the full permission lifecycle — not just the happy path:
 *   • First ask  → OS dialog via `requestPermission`.
 *   • Denied but can ask again → button re-requests (shows the dialog again).
 *   • Denied AND canAskAgain === false → the OS will NEVER show the dialog
 *     again, so we deep-link the user into the app's Settings page where
 *     they can flip the permission on manually.
 *   • On returning from Settings (AppState → active) we re-check the status
 *     so the UI updates without a manual refresh, and celebrate a fresh
 *     false→true grant (haptic + VoiceOver announcement).
 *   • Missing native module (`checkStatus` returns null, e.g. Expo Go) —
 *     degrade gracefully and just let the user continue.
 *
 * Post-grant beat is unified: the success pill renders for ~900ms, then the
 * screen auto-advances (timer cleared on unmount so back-out never fires a
 * stale navigation).
 */
export function PermissionPrimer({
  illustrationSource,
  title,
  reasons,
  stepIndex,
  privacyNote,
  checkStatus,
  requestPermission,
  grantedLabel,
  blockedTitle,
  blockedBody,
  allowLabel,
  requestErrorMessage,
  skipHint,
  onNext,
}: PermissionPrimerProps) {
  const { width, vScale, isLandscape, contentMaxWidth } = useResponsive();
  const reduceMotion = useReducedMotion();

  const [granted, setGranted] = useState(false);
  const [canAskAgain, setCanAskAgain] = useState(true);
  // Native module missing (Expo Go) — nothing to request, CTA becomes Continue.
  const [unavailable, setUnavailable] = useState(false);
  // Mirrors `granted` synchronously so the AppState handler can detect a
  // false→true transition (and fire the success haptic) without stale state.
  const grantedRef = useRef(false);
  // Announce the blocked state to screen readers only once per visit.
  const blockedAnnouncedRef = useRef(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timer callbacks read the latest onNext through a ref, never a stale closure.
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;

  /** Navigate immediately, cancelling any pending post-grant auto-advance. */
  const advanceNow = useCallback(() => {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
    onNextRef.current();
  }, []);

  /** Let the success pill land for a beat, then advance (idempotent). */
  const scheduleAdvance = useCallback(() => {
    if (advanceTimer.current) return;
    advanceTimer.current = setTimeout(() => {
      advanceTimer.current = null;
      onNextRef.current();
    }, 900);
  }, []);

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    [],
  );

  const celebrateGrant = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // accessibilityLiveRegion on the pill is Android-only; this covers iOS VoiceOver.
    AccessibilityInfo.announceForAccessibility(`${grantedLabel}. Continuing to the next step.`);
    scheduleAdvance();
  }, [grantedLabel, scheduleAdvance]);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await checkStatus();
      if (!res) {
        setUnavailable(true);
        return;
      }
      grantedRef.current = res.granted;
      setGranted(res.granted);
      setCanAskAgain(res.canAskAgain);
    } catch {
      // Treat a failing native call as "not granted" — never crash the screen.
    }
  }, [checkStatus]);

  useEffect(() => {
    refreshStatus();
    // Re-check whenever the user comes back to the app (e.g. after toggling
    // the permission in the OS Settings screen) and celebrate a fresh grant.
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      const wasGranted = grantedRef.current;
      await refreshStatus();
      if (!wasGranted && grantedRef.current) celebrateGrant();
    });
    return () => sub.remove();
  }, [refreshStatus, celebrateGrant]);

  // iOS VoiceOver announcement for the blocked banner (liveRegion is Android-only).
  useEffect(() => {
    if (!granted && !canAskAgain && !blockedAnnouncedRef.current) {
      blockedAnnouncedRef.current = true;
      AccessibilityInfo.announceForAccessibility(`${blockedTitle}. ${blockedBody}`);
    }
  }, [granted, canAskAgain, blockedTitle, blockedBody]);

  const handleAllow = async () => {
    if (granted || unavailable) return advanceNow();

    // If the OS won't show the dialog anymore, the ONLY way to grant is via
    // the system Settings page — take the user straight there.
    if (!canAskAgain) {
      await Linking.openSettings();
      return;
    }

    try {
      const res = await requestPermission();
      if (!res) {
        setUnavailable(true);
        return advanceNow();
      }
      grantedRef.current = res.granted;
      setGranted(res.granted);
      setCanAskAgain(res.canAskAgain);
      // Only advance once they've actually granted — otherwise keep them
      // here so the "Open Settings" affordance can appear.
      if (res.granted) celebrateGrant();
    } catch {
      toast.error(requestErrorMessage);
    }
  };

  const handleSkip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    advanceNow();
  };

  const buttonTitle =
    granted || unavailable ? 'Continue' : !canAskAgain ? 'Open Settings to enable' : allowLabel;

  // Content-priority in landscape: the checklist is the core content, the
  // illustration is decoration — hide it rather than clip the CTA.
  const illustrationSize = isLandscape ? 0 : Math.min(320, vScale(300), width - 48);
  const maxWidthClamp = { width: '100%' as const, maxWidth: contentMaxWidth, alignSelf: 'center' as const };

  return (
    <SafeAreaView className="flex-1 bg-background" style={s.container}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, maxWidthClamp]}
        showsVerticalScrollIndicator={false}
      >
        {illustrationSize > 0 && (
          <MotiView
            from={reduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'timing', duration: reduceMotion ? 0 : 300 }}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {/* The artwork PNGs are transparent, so render them directly on the
                screen — no white medallion (which read as a stray box). Sized
                up now that the image blends into the background instead of
                sitting inside a frame. */}
            <Image
              source={illustrationSource}
              style={{ width: illustrationSize, height: illustrationSize, marginBottom: 16 }}
              resizeMode="contain"
              accessible={false}
            />
          </MotiView>
        )}

        <View style={s.stepRow} accessible accessibilityLabel={`Step ${stepIndex} of 2`}>
          {([1, 2] as const).map((n) => (
            <View key={n} style={[s.stepDot, n === stepIndex && s.stepDotActive]} />
          ))}
        </View>

        <Text
          className="text-[26px] font-montserrat-bold text-ink text-center"
          style={s.title}
          accessibilityRole="header"
        >
          {title}
        </Text>

        <View style={s.whyList}>
          {reasons.map((reason, i) => (
            <MotiView
              key={reason}
              style={s.whyRow}
              from={reduceMotion ? undefined : { opacity: 0, translateY: 8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{
                type: 'timing',
                duration: reduceMotion ? 0 : 250,
                delay: reduceMotion ? 0 : 120 + i * 40,
              }}
            >
              <View style={s.whyChip}>
                <Check size={14} color={LightColors.primary} strokeWidth={3} />
              </View>
              <Text className="text-[14px] font-montserrat text-textSecondary flex-1">
                {reason}
              </Text>
            </MotiView>
          ))}
        </View>

        {privacyNote && (
          <View style={s.privacyRow}>
            <Lock size={13} color={LightColors.textMuted} />
            <Text className="text-[12px] font-montserrat text-textTertiary flex-shrink text-center">
              {privacyNote}
            </Text>
          </View>
        )}

        {/* Reserved status slot — always occupies layout so the pill/banner
            fades in without shifting the centered column. */}
        <View style={s.statusSlot}>
          {granted ? (
            <MotiView
              from={reduceMotion ? undefined : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: reduceMotion ? 0 : 200 }}
              style={s.grantedInline}
              accessibilityLiveRegion="polite"
            >
              <CheckCircle size={16} color={LightColors.successDark} />
              <Text className="text-[13px] font-montserrat-semi text-successDark ml-1.5">
                {grantedLabel}
              </Text>
            </MotiView>
          ) : !canAskAgain ? (
            <MotiView
              from={reduceMotion ? undefined : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: reduceMotion ? 0 : 200 }}
              style={s.blockedInline}
              accessibilityLiveRegion="polite"
            >
              <SettingsIcon size={15} color={LightColors.warningDark} />
              <View style={s.blockedTextCol}>
                <Text className="text-[13px] font-montserrat-semi text-warningDark">
                  {blockedTitle}
                </Text>
                <Text className="text-[12px] font-montserrat text-textSecondary mt-0.5">
                  {blockedBody}
                </Text>
              </View>
            </MotiView>
          ) : null}
        </View>
      </ScrollView>

      <View style={[s.footer, maxWidthClamp]}>
        <Button title={buttonTitle} fullWidth size="lg" onPress={handleAllow} />
        {/* Skip stays in layout when granted so the CTA never jumps at the
            moment the user reaches to tap it. */}
        <Pressable
          onPress={handleSkip}
          disabled={granted}
          hitSlop={{ top: 0, bottom: 12, left: 24, right: 24 }}
          style={({ pressed }) => [
            s.skipBtn,
            granted && { opacity: 0 },
            !granted && pressed && { opacity: 0.55 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Not now"
          accessibilityHint={skipHint}
          accessibilityElementsHidden={granted}
          importantForAccessibility={granted ? 'no-hide-descendants' : 'auto'}
        >
          <Text className="text-[14px] font-montserrat text-textSecondary text-center">
            Not now
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { paddingHorizontal: 24 },
  scroll: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  stepDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: LightColors.dividerStrong,
  },
  stepDotActive: {
    width: 16,
    borderRadius: 999,
    backgroundColor: LightColors.primary,
  },
  title: { marginBottom: 8, lineHeight: 32, letterSpacing: -0.4 },
  whyList: { marginTop: 12, alignSelf: 'stretch', gap: 12, paddingHorizontal: 8 },
  whyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  whyChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: LightColors.primary50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 12,
  },
  statusSlot: {
    minHeight: 56,
    marginTop: 16,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  grantedInline: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: LightColors.successLight,
  },
  blockedInline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: LightColors.warningLight,
  },
  blockedTextCol: { flex: 1, marginLeft: 6 },
  footer: { paddingBottom: 28, gap: 12 },
  skipBtn: { minHeight: 44, paddingVertical: 12, justifyContent: 'center' },
});
