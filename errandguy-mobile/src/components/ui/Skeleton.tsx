import React, { useEffect } from 'react';
import {
  View,
  StyleSheet,
  useWindowDimensions,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { LightColors, Elevation } from '../../constants/colors';

// ── Shimmer bar ───────────────────────────────────────────────
// Uses a pure Reanimated sliding overlay instead of expo-linear-gradient to
// avoid the "Unable to get view config for ExpoLinearGradient" Android warning
// that fires when requireNativeViewManager is called before the UI Manager is ready.
interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({
  width = '100%',
  height = 16,
  // 12px so skeleton blocks read as the same family as the new
  // 16/20px form elements / cards without looking like fat pills.
  borderRadius = 12,
  style,
}: SkeletonProps) {
  const progress = useSharedValue(0);
  // Honor the OS "Reduce Motion" preference. Indefinite shimmer
  // animations are an accessibility flashpoint (motion sensitivity,
  // vestibular triggers); we keep the placeholder block visible but
  // freeze the moving overlay.
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 0;
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.linear }),
      -1,
      false,
    );
  }, [progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(progress.value, [0, 1], [-220, 220]),
      },
    ],
    opacity: interpolate(progress.value, [0, 0.5, 1], [0, 0.55, 0]),
  }));

  return (
    <View
      // Block content reads from screen readers while loading — the parent
      // screen typically renders an aria-busy region; the skeleton itself
      // shouldn't speak "rectangle".
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: LightColors.divider,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {!reduceMotion && (
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: 200,
              backgroundColor: LightColors.surface,
            },
            animatedStyle,
          ]}
        />
      )}
    </View>
  );
}

// ── Circle (avatars) ──────────────────────────────────────────
interface SkeletonCircleProps {
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonCircle({ size = 48, style }: SkeletonCircleProps) {
  return <Skeleton width={size} height={size} borderRadius={size / 2} style={style} />;
}

// ── Prebuilt screen skeletons ─────────────────────────────────

/**
 * Home screen skeleton — traces the shipped ride-hailing home layout:
 * full-bleed gradient hero with floating chrome chips, the overlapping
 * destination card, quick-action pills, service tiles and recent rows.
 * Renders edge-to-edge (it pads the hero row with the top inset itself)
 * so the real hero doesn't jump when content swaps in.
 */
export function HomeSkeleton() {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1">
      {/* Full-bleed hero placeholder */}
      <View style={{ height: 300, backgroundColor: LightColors.divider }}>
        {/* Floating chrome row — avatar chip, greeting pill, search + bell.
            Surface fill so the chips read against the divider hero. */}
        <View
          className="flex-row items-center px-5"
          style={{ paddingTop: insets.top + 8, gap: 10 }}
        >
          <SkeletonCircle size={40} style={{ backgroundColor: LightColors.surface }} />
          <Skeleton
            width={140}
            height={40}
            borderRadius={20}
            style={{ marginRight: 'auto', backgroundColor: LightColors.surface }}
          />
          <SkeletonCircle size={40} style={{ backgroundColor: LightColors.surface }} />
          <SkeletonCircle size={40} style={{ backgroundColor: LightColors.surface }} />
        </View>
      </View>

      {/* Destination card — floats up over the hero edge like the real one */}
      <View className="px-5" style={{ marginTop: -44 }}>
        <View
          className="bg-surface px-4 py-4 justify-center"
          style={{ borderRadius: 20, height: 110, ...Elevation.md }}
        >
          <Skeleton width="55%" height={12} style={{ marginBottom: 14 }} />
          <View className="flex-row items-center">
            <Skeleton width="65%" height={14} style={{ marginRight: 'auto' }} />
            <SkeletonCircle size={32} />
          </View>
        </View>
      </View>

      {/* Quick-action pills */}
      <View className="flex-row px-5 mt-3" style={{ gap: 8 }}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} width={96} height={40} borderRadius={20} />
        ))}
      </View>

      <View className="px-5 pt-7">
        {/* Service tiles title */}
        <Skeleton width="45%" height={14} style={{ marginBottom: 12 }} />

        {/* Service tiles — four 25% tiles like the shipped grid */}
        <View className="flex-row -mx-1.5">
          {[1, 2, 3, 4].map((i) => (
            <View key={i} className="px-1.5" style={{ width: '25%' }}>
              <View
                className="bg-surface items-center justify-center"
                style={{ borderRadius: 16, minHeight: 88, ...Elevation.sm }}
              >
                <SkeletonCircle size={40} style={{ marginBottom: 8 }} />
                <Skeleton width={44} height={10} />
              </View>
            </View>
          ))}
        </View>

        {/* Recent errands title */}
        <Skeleton width="35%" height={14} style={{ marginTop: 24, marginBottom: 14 }} />

        {/* Recent errand cards */}
        {[1, 2, 3].map((i) => (
          <View
            key={i}
            className="bg-surface rounded-2xl p-4 mb-2.5"
            style={Elevation.sm}
          >
            <View className="flex-row items-center">
              <Skeleton width={40} height={40} borderRadius={12} />
              <View className="flex-1 ml-3">
                <Skeleton width="60%" height={14} style={{ marginBottom: 6 }} />
                <Skeleton width="35%" height={10} />
              </View>
              <Skeleton width={56} height={22} borderRadius={12} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Just the booking-card loop — for swapping in place of a list while
 *  its chrome (title, filter chips) stays mounted. No padding of its
 *  own; the host list region provides it. */
export function ActivityListSkeleton() {
  return (
    <View>
      {[1, 2, 3, 4].map((i) => (
        <View
          key={i}
          className="bg-surface rounded-xl p-4 mb-3"
          style={{ borderWidth: 1, borderColor: LightColors.divider }}
        >
          <View className="flex-row items-center mb-3">
            <Skeleton width={32} height={32} borderRadius={8} />
            <View className="flex-1 ml-3">
              <Skeleton width="50%" height={14} />
            </View>
            <Skeleton width={56} height={20} borderRadius={10} />
          </View>
          <Skeleton width="90%" height={10} style={{ marginBottom: 4 }} />
          <Skeleton width="80%" height={10} style={{ marginBottom: 8 }} />
          <View className="flex-row justify-between">
            <Skeleton width="35%" height={10} />
            <Skeleton width="20%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Activity / bookings list skeleton — full-screen variant with title +
 *  filter-chip chrome. Kept for whole-screen first loads. */
export function ActivitySkeleton() {
  return (
    <View className="flex-1 px-5 pt-4">
      {/* Title */}
      <Skeleton width="30%" height={22} style={{ marginBottom: 16 }} />

      {/* Filter chips */}
      <View className="flex-row gap-2 mb-5">
        {[60, 52, 72, 68].map((w, i) => (
          <Skeleton key={i} width={w} height={32} borderRadius={16} />
        ))}
      </View>

      {/* Booking cards */}
      <ActivityListSkeleton />
    </View>
  );
}

/**
 * Tracking screen skeleton — mirrors the HORIZON layout the live screen
 * resolves to, so a cold start (no cached booking) never jumps from a
 * top-anchored placeholder to floating-chrome + bottom-sheet when data
 * lands. Three pieces, matching tracking/[id].tsx:
 *   1. A full-bleed canvas (the phase-gated map / gradient region).
 *   2. Floating chrome — a 44pt back circle + a centered status pill,
 *      surface-white so they read against the divider canvas, offset by
 *      the top inset exactly like the real SafeAreaView chrome.
 *   3. A bottom sheet pinned to the half snap (SNAP_POINTS.half = 0.52 →
 *      top at 0.48·height) with a 28pt top radius + drag handle, an
 *      ETA-led handle block (eyebrow bar → big numeral/headline → beads
 *      track → avatar), then a runner-card body row.
 */
export function TrackingSkeleton() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // 1 - SNAP_POINTS.half (0.52): the sheet placeholder lands where the real
  // sheet opens at the default 'half' snap, so nothing shifts on resolve.
  const sheetTop = Math.round(height * 0.48);
  return (
    <View className="flex-1" style={{ overflow: 'hidden' }}>
      {/* Full-bleed canvas — neutral until we know whether the trip resolves
          into gradient (pre-dispatch) or map (en-route) mode. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: LightColors.divider }]} />

      {/* Floating chrome — back circle left, centered status pill, 44pt
          spacer right so the pill sits optically centered (mirrors the live
          chrome's back + spacer). */}
      <View
        className="flex-row items-center px-4"
        style={{ paddingTop: insets.top + 8 }}
      >
        <SkeletonCircle size={44} style={{ backgroundColor: LightColors.surface }} />
        <View className="flex-1 items-center px-2">
          <Skeleton
            width={150}
            height={36}
            borderRadius={18}
            style={{ backgroundColor: LightColors.surface }}
          />
        </View>
        <View style={{ width: 44 }} />
      </View>

      {/* Bottom sheet — pinned to the half snap, 28pt top radius + handle. */}
      <View
        className="absolute left-0 right-0 bottom-0 bg-surface"
        style={{
          top: sheetTop,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          shadowColor: LightColors.textPrimary,
          shadowOffset: { width: 0, height: -10 },
          shadowOpacity: 0.08,
          shadowRadius: 24,
          elevation: 24,
        }}
      >
        {/* Drag handle bar */}
        <View className="items-center pt-2 pb-1">
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: LightColors.dividerStrong,
            }}
          />
        </View>

        {/* ETA-led handle — eyebrow + big numeral/headline on the left,
            avatar + name on the right, over a full-width beads track. */}
        <View className="px-5 pt-1">
          <View className="flex-row items-start">
            <View className="flex-1 pr-3">
              <Skeleton width={90} height={12} borderRadius={6} style={{ marginBottom: 10 }} />
              <Skeleton width={120} height={36} borderRadius={10} />
            </View>
            <View className="items-center">
              <SkeletonCircle size={40} />
              <Skeleton width={44} height={11} borderRadius={5} style={{ marginTop: 6 }} />
            </View>
          </View>

          {/* Beads track — the 2px line + 6 dots the JourneyBeads renders. */}
          <View className="pt-4">
            <View className="relative h-3 justify-center">
              <View
                className="absolute left-0 right-0"
                style={{
                  top: '50%',
                  marginTop: -1,
                  height: 2,
                  borderRadius: 1,
                  backgroundColor: LightColors.divider,
                }}
              />
              <View className="flex-row items-center justify-between">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <View
                    key={i}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: LightColors.dividerStrong,
                    }}
                  />
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* Body — a runner card row (avatar + name/rating over a hairline
            divider, then a three-chip action row), matching the live
            runnerCard so the first body card keeps its footprint on resolve. */}
        <View className="px-5 pt-5">
          <View
            className="bg-surface rounded-3xl p-4"
            style={Elevation.sm}
          >
            <View className="flex-row items-center">
              <SkeletonCircle size={52} />
              <View className="flex-1 ml-3.5">
                <Skeleton width="55%" height={14} style={{ marginBottom: 8 }} />
                <Skeleton width="35%" height={11} />
              </View>
              <Skeleton width={72} height={24} borderRadius={12} />
            </View>
            <View className="h-px bg-divider my-3.5" />
            <View className="flex-row">
              {[0, 1, 2].map((i) => (
                <View key={i} className="flex-1 items-center">
                  <SkeletonCircle size={44} style={{ marginBottom: 6 }} />
                  <Skeleton width={40} height={11} borderRadius={5} />
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

/** Contact list skeleton */
export function ContactsSkeleton() {
  return (
    <View className="flex-1 px-5 pt-4">
      {/* Info banner */}
      <Skeleton width="100%" height={56} borderRadius={12} style={{ marginBottom: 16 }} />

      {/* Contact cards */}
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          className="bg-surface rounded-xl p-4 mb-3"
          style={{ borderWidth: 1, borderColor: LightColors.divider }}
        >
          <View className="flex-row items-center mb-2">
            <SkeletonCircle size={40} />
            <View className="flex-1 ml-3">
              <Skeleton width="50%" height={14} style={{ marginBottom: 4 }} />
              <Skeleton width="35%" height={10} />
            </View>
            <Skeleton width={56} height={22} borderRadius={12} />
          </View>
          <Skeleton width="45%" height={10} />
        </View>
      ))}
    </View>
  );
}

/**
 * Runner home skeleton — traces the reworked dashboard so a cold start
 * (profile + history still loading) never swaps layouts when data lands.
 * Order mirrors index.tsx: safe-area greeting row (avatar + two text
 * lines + bell), the blue gradient earnings hero carrying the big
 * today's-total numeral and the round online power toggle, the hairline
 * Lifetime metric strip, then the 2-up shortcut grid.
 *
 * The gradient hero is stood in by a neutral divider block with
 * surface-white placeholders inside (same trick HomeSkeleton uses for
 * its hero chips) so the silhouette reads against it.
 */
export function RunnerHomeSkeleton() {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1">
      {/* Greeting row — avatar, welcome + name, bell. Pads the top inset
          itself (the live row sits inside a top-edge SafeAreaView + pt-2). */}
      <View
        className="flex-row items-center px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}
      >
        <SkeletonCircle size={40} />
        <View className="flex-1 ml-3">
          <Skeleton width={72} height={10} style={{ marginBottom: 6 }} />
          <Skeleton width={110} height={14} />
        </View>
        <SkeletonCircle size={40} />
      </View>

      {/* Earnings hero — gradient balance card placeholder. */}
      <View className="px-5 pt-1 pb-5">
        <View
          style={{
            borderRadius: 24,
            padding: 20,
            backgroundColor: LightColors.divider,
            ...Elevation.md,
          }}
        >
          <View className="flex-row items-center">
            <View className="flex-1 pr-4">
              <Skeleton
                width={100}
                height={10}
                style={{ marginBottom: 12, backgroundColor: LightColors.surface }}
              />
              <Skeleton
                width={150}
                height={34}
                borderRadius={10}
                style={{ backgroundColor: LightColors.surface }}
              />
              <Skeleton
                width={130}
                height={12}
                style={{ marginTop: 12, backgroundColor: LightColors.surface }}
              />
            </View>
            {/* Power toggle disc + GO/ONLINE label */}
            <View className="items-center" style={{ width: 80 }}>
              <SkeletonCircle size={72} style={{ backgroundColor: LightColors.surface }} />
              <Skeleton
                width={32}
                height={11}
                style={{ marginTop: 8, backgroundColor: LightColors.surface }}
              />
            </View>
          </View>

          {/* Goal affordance line */}
          <Skeleton
            width={140}
            height={12}
            style={{ marginTop: 16, backgroundColor: LightColors.surface }}
          />

          {/* Status caption over the card's hairline top rule */}
          <View
            className="flex-row items-center"
            style={{
              marginTop: 16,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: LightColors.dividerStrong,
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                marginRight: 6,
                backgroundColor: LightColors.surface,
              }}
            />
            <Skeleton width={160} height={11} style={{ backgroundColor: LightColors.surface }} />
          </View>
        </View>
      </View>

      {/* Lifetime strip — eyebrow + three metrics inside a hairline y-rule. */}
      <View className="px-5 pt-1">
        <Skeleton width="22%" height={10} style={{ marginBottom: 10 }} />
        <View className="flex-row py-4 border-y border-divider">
          {[0, 1, 2].map((i) => (
            <React.Fragment key={i}>
              {i > 0 && <View className="w-px bg-divider" />}
              <View className="flex-1 items-center">
                <Skeleton width={38} height={20} style={{ marginBottom: 8 }} />
                <Skeleton width={54} height={10} />
              </View>
            </React.Fragment>
          ))}
        </View>
      </View>

      {/* Shortcuts — eyebrow + 2-up grid of hairline rows. */}
      <View className="px-5 pt-6">
        <Skeleton width="26%" height={10} style={{ marginBottom: 12 }} />
        <View className="flex-row flex-wrap" style={{ marginHorizontal: -6 }}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={{ width: '50%', paddingHorizontal: 6, paddingBottom: 12 }}
            >
              <View
                className="bg-surface px-4 py-4 rounded-2xl border border-divider flex-row items-center"
              >
                <SkeletonCircle size={40} style={{ marginRight: 12 }} />
                <Skeleton width="52%" height={12} />
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * Runner history skeleton — mounts under the live GradientHeader (which
 * owns the "Errands" title), so it must NOT draw its own title. Mirrors
 * the reworked chrome: a hairline UNDERLINE search row and UNDERLINE
 * filter tabs (no box, no pills), then Card-language rows matching the
 * live errand card (type + status pill on the left, date + payout on the
 * right, a pickup→dropoff bead timeline below). Keeps four card
 * placeholders so nothing reshapes when the real list lands.
 */
export function HistorySkeleton() {
  return (
    <View className="flex-1 px-5">
      {/* Underline search — thin bottom rule, 44pt row (no rounded box) */}
      <View
        className="flex-row items-center border-b border-divider mb-2"
        style={{ minHeight: 44 }}
      >
        <Skeleton width={16} height={16} borderRadius={4} />
        <Skeleton width="45%" height={12} style={{ marginLeft: 8 }} />
      </View>

      {/* Underline filter tabs — short text-width blocks on a bottom rule */}
      <View
        className="flex-row border-b border-divider mb-1"
        style={{ paddingBottom: 12 }}
      >
        {[28, 66, 62].map((w, i) => (
          <Skeleton key={i} width={w} height={12} style={{ marginRight: 20 }} />
        ))}
      </View>

      {/* Errand cards — mirror the live <Card> silhouette */}
      <View style={{ paddingTop: 8 }}>
        {[1, 2, 3, 4].map((i) => (
          <View
            key={i}
            className="bg-surface rounded-2xl p-4 mb-3"
            style={Elevation.sm}
          >
            {/* Top row — type + status pill left, date + payout right */}
            <View className="flex-row items-start mb-3">
              <View className="flex-1 pr-3">
                <Skeleton width="55%" height={14} style={{ marginBottom: 8 }} />
                <Skeleton width={74} height={18} borderRadius={9} />
              </View>
              <View className="items-end">
                <Skeleton width={44} height={11} style={{ marginBottom: 6 }} />
                <Skeleton width={60} height={14} />
              </View>
            </View>

            {/* Route — pickup/dropoff bead timeline + two address lines */}
            <View className="flex-row">
              <View className="items-center mr-3" style={{ width: 10 }}>
                <SkeletonCircle size={10} />
                <View
                  style={{
                    flex: 1,
                    width: 1,
                    minHeight: 14,
                    marginVertical: 4,
                    backgroundColor: LightColors.divider,
                  }}
                />
                <SkeletonCircle size={10} />
              </View>
              <View className="flex-1">
                <Skeleton width="80%" height={12} />
                <Skeleton width="65%" height={12} style={{ marginTop: 8 }} />
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Chat THREAD skeleton — alternating incoming (left, with avatar gutter) and
 * outgoing (right) bubble placeholders so a first-load thread reads as a
 * conversation filling in rather than a blank void with one tiny spinner.
 *
 * Bubble corner (16) mirrors the live rounded-2xl message bubbles so the
 * shimmer dissolves into real bubbles on resolve. Rendered inside the chat
 * FlatList's inverted ListEmptyComponent, so the caller counter-flips it
 * (scaleY:-1); visually it's just rectangles so the flip is invisible.
 */
const CHAT_BUBBLES: { side: 'in' | 'out'; width: `${number}%`; height: number }[] = [
  { side: 'in', width: '58%', height: 40 },
  { side: 'out', width: '46%', height: 34 },
  { side: 'in', width: '70%', height: 52 },
  { side: 'out', width: '60%', height: 40 },
  { side: 'in', width: '40%', height: 34 },
  { side: 'out', width: '52%', height: 40 },
];

export function ChatThreadSkeleton() {
  return (
    <View className="px-4 pt-4">
      {CHAT_BUBBLES.map((b, i) => {
        const incoming = b.side === 'in';
        return (
          <View
            key={i}
            className="flex-row items-end mb-3"
            style={{ justifyContent: incoming ? 'flex-start' : 'flex-end' }}
          >
            {incoming && <SkeletonCircle size={28} style={{ marginRight: 8 }} />}
            <Skeleton width={b.width} height={b.height} borderRadius={16} />
          </View>
        );
      })}
    </View>
  );
}

/**
 * Chat INBOX skeleton — 5 conversation-card placeholders. Extracted verbatim
 * from ConversationList's inline ListEmptyComponent so the inbox first-load
 * silhouette lives with the other prebuilt skeletons.
 */
export function ChatInboxSkeleton() {
  return (
    <View className="pt-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <View
          key={i}
          className="mx-5 mb-2.5 bg-surface rounded-2xl p-3"
          style={{ borderWidth: 1, borderColor: LightColors.divider }}
        >
          <View className="flex-row items-center">
            <SkeletonCircle size={44} />
            <View className="flex-1 ml-3">
              <View className="flex-row items-center justify-between">
                <Skeleton width="45%" height={13} />
                <Skeleton width={28} height={10} />
              </View>
              <Skeleton width="55%" height={10} style={{ marginTop: 7 }} />
              <Skeleton width="75%" height={11} style={{ marginTop: 7 }} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}
