import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Sparkles,
  Wallet,
  ShieldCheck,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react-native';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { useUpdateStore } from '../../stores/updateStore';
import { LightColors } from '../../constants/colors';
import { haptics } from '../../utils/haptics';

/**
 * "What's New" changelog sheet — shown ONCE per changelog release.
 *
 * Self-gating: mounted permanently as a sibling in the root layout, it renders
 * `null` until it is eligible (CHANGELOG_VERSION differs from the persisted
 * `lastSeenVersion`, and there are highlights to show). It NEVER blocks launch.
 *
 * How the gate fires:
 *   • On mount we hydrate `lastSeenVersion` from storage (via updateStore).
 *   • A brand-new install (no stored version) is silently seeded to the
 *     current CHANGELOG_VERSION — we don't hand a first-time user a changelog
 *     for content they've effectively "already caught up" on.
 *   • Otherwise, if CHANGELOG_VERSION differs from the seen one and HIGHLIGHTS
 *     is non-empty, the sheet opens once. Dismissing (or tapping a highlight)
 *     records the current CHANGELOG_VERSION as seen so it won't fire again.
 *
 * To ship a new "What's New": edit HIGHLIGHTS below AND bump CHANGELOG_VERSION.
 * We gate on that hand-bumped constant, NOT the runtime/app version — under the
 * appVersion runtime policy an OTA release never changes the runtime version,
 * so keying off it would leave the sheet dormant for every OTA release.
 */

interface Highlight {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  /** Optional in-app deep link. Tapping the row closes the sheet and routes. */
  href?: string;
}

// Edit this list per release. Keep it to 1–3 punchy highlights. An empty list
// disables the sheet entirely (the gate renders null).
const HIGHLIGHTS: Highlight[] = [
  {
    id: 'faster-matching',
    icon: Sparkles,
    title: 'Faster runner matching',
    body: 'We find you a nearby runner quicker, with fewer taps to book.',
  },
  {
    id: 'wallet-topups',
    icon: Wallet,
    title: 'Smoother wallet top-ups',
    body: 'Top up in a couple of taps and pay for errands straight from your balance.',
    href: '/(customer)/wallet',
  },
  {
    id: 'safer-payments',
    icon: ShieldCheck,
    title: 'Safer payments',
    body: 'Every payment is now verified end-to-end so an outcome is never left in doubt.',
  },
];

/**
 * Bump this whenever HIGHLIGHTS changes — it's what the sheet gates on, so it
 * fires exactly once per changelog. Deliberately NOT the runtime/app version:
 * under the `appVersion` runtime policy an OTA update (our primary release
 * channel) matches — and never changes — the runtime version, so keying off it
 * would leave the sheet dormant for every OTA-delivered release. A hand-bumped
 * constant fires reliably regardless of OTA-vs-store delivery.
 */
const CHANGELOG_VERSION = '1';

export function WhatsNewSheet() {
  const router = useRouter();
  const lastSeenVersion = useUpdateStore((s) => s.lastSeenVersion);
  const whatsNewHydrated = useUpdateStore((s) => s.whatsNewHydrated);
  const loadLastSeenVersion = useUpdateStore((s) => s.loadLastSeenVersion);
  const setLastSeenVersion = useUpdateStore((s) => s.setLastSeenVersion);

  const [visible, setVisible] = useState(false);
  // Guard so the gate decision runs at most once per app session.
  const decidedRef = useRef(false);
  const version = CHANGELOG_VERSION;

  // Hydrate the persisted marker once.
  useEffect(() => {
    void loadLastSeenVersion();
  }, [loadLastSeenVersion]);

  // Decide eligibility once storage has been read.
  useEffect(() => {
    if (!whatsNewHydrated || decidedRef.current) return;
    // No resolvable version (dev / Expo Go) or nothing to show → stay dormant.
    if (!version || HIGHLIGHTS.length === 0) {
      decidedRef.current = true;
      return;
    }
    decidedRef.current = true;

    if (lastSeenVersion === null) {
      // Fresh install / first run after this feature shipped — seed silently.
      setLastSeenVersion(version);
      return;
    }
    if (lastSeenVersion !== version) {
      haptics.light();
      setVisible(true);
    }
  }, [whatsNewHydrated, version, lastSeenVersion, setLastSeenVersion]);

  const markSeen = () => {
    if (version) setLastSeenVersion(version);
  };

  const handleClose = () => {
    setVisible(false);
    markSeen();
  };

  const handleHighlightPress = (href?: string) => {
    if (!href) return;
    handleClose();
    // Defer navigation a tick so the sheet's dismiss animation isn't fighting
    // the route transition.
    setTimeout(() => {
      router.push(href as never);
    }, 220);
  };

  if (!visible) return null;

  const snap = Math.min(0.72, 0.34 + HIGHLIGHTS.length * 0.12);

  return (
    <BottomSheet
      isVisible={visible}
      onClose={handleClose}
      snapPoints={[snap]}
      avoidKeyboard={false}
    >
      <View className="pt-1">
        <Text className="text-[22px] font-montserrat-bold text-textPrimary mb-1">
          What&apos;s new
        </Text>
        <Text className="text-[14px] font-montserrat text-textSecondary mb-5">
          A few improvements just landed in this update.
        </Text>

        <View className="gap-4 mb-6">
          {HIGHLIGHTS.map((h) => {
            const Icon = h.icon;
            const interactive = !!h.href;
            const Row = interactive ? Pressable : View;
            return (
              <Row
                key={h.id}
                className="flex-row items-start"
                {...(interactive
                  ? {
                      onPress: () => handleHighlightPress(h.href),
                      accessibilityRole: 'button' as const,
                      accessibilityLabel: h.title,
                      accessibilityHint: 'Opens this feature',
                    }
                  : {})}
              >
                <View className="w-11 h-11 rounded-full bg-surfaceMuted items-center justify-center mr-3">
                  <Icon size={20} color={LightColors.primary} strokeWidth={2} />
                </View>
                <View className="flex-1">
                  <Text className="text-[15px] font-montserrat-semi text-textPrimary mb-0.5">
                    {h.title}
                  </Text>
                  <Text className="text-[13px] font-montserrat text-textSecondary leading-[18px]">
                    {h.body}
                  </Text>
                </View>
                {interactive && (
                  <ChevronRight
                    size={18}
                    color={LightColors.textSecondary}
                    strokeWidth={2}
                    style={{ marginTop: 12, marginLeft: 4 }}
                  />
                )}
              </Row>
            );
          })}
        </View>

        <Button title="Got it" fullWidth onPress={handleClose} />
      </View>
    </BottomSheet>
  );
}
