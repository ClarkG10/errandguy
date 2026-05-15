import React from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

/**
 * Onboarding illustrations.
 *
 * Three sibling SVG scenes that share one design language so the
 * three-step welcome carousel feels like a single story rather than
 * a stitched-together stock pack:
 *
 *   • Square 1:1 viewBox (320×320) — uniform proportions across slides.
 *   • Single brand-blue palette (`primary50…700`) with a single warm
 *     accent (`accent` = #F59E0B) used sparingly to draw the eye.
 *   • Soft circular halo + grouped surfaces sit on a transparent
 *     background, so the underlying gradient hero reads through.
 *   • Drawn with Path/Rect/Circle primitives only — zero asset
 *     dependencies and no Hermes bytecode bloat.
 *
 * Each illustration accepts a `size` prop (defaults to 240pt) so the
 * same component can render at different sizes (welcome carousel vs.
 * an empty state) without re-exporting variants.
 */

const PALETTE = {
  primary50: '#EFF6FF',
  primary100: '#DBEAFE',
  primary200: '#BFDBFE',
  primary300: '#93C5FD',
  primary400: '#60A5FA',
  primary500: '#3B82F6',
  primary600: '#2563EB',
  primary700: '#1D4ED8',
  primary800: '#1E40AF',
  ink: '#0F172A',
  paper: '#FFFFFF',
  accent: '#F59E0B',
  success: '#22C55E',
  shadow: 'rgba(15,23,42,0.10)',
} as const;

interface IllustrationProps {
  /** Render size in points. Defaults to 240. */
  size?: number;
  /** Optional outer style (margins / alignment). */
  style?: ViewStyle;
}

/* ──────────────────────────────────────────────────────────────────
 * Shared scaffold — soft halo + ground shadow used by every slide.
 * ────────────────────────────────────────────────────────────────── */

function Stage({
  size,
  children,
}: React.PropsWithChildren<{ size: number }>) {
  return (
    <Svg width={size} height={size} viewBox="0 0 320 320" fill="none">
      <Defs>
        <LinearGradient id="halo" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={PALETTE.primary100} stopOpacity={0.9} />
          <Stop offset="100%" stopColor={PALETTE.primary50} stopOpacity={0.0} />
        </LinearGradient>
        <LinearGradient id="cardBlue" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={PALETTE.primary500} />
          <Stop offset="100%" stopColor={PALETTE.primary700} />
        </LinearGradient>
        <LinearGradient id="paperHi" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#FFFFFF" />
          <Stop offset="100%" stopColor={PALETTE.primary50} />
        </LinearGradient>
      </Defs>

      {/* Soft halo behind the whole scene */}
      <Circle cx="160" cy="160" r="138" fill="url(#halo)" />
      {/* Ground shadow */}
      <Ellipse cx="160" cy="262" rx="92" ry="10" fill={PALETTE.shadow} />
      {children}
    </Svg>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * 1. Book any errand — phone with errand-type chips fanning out
 * ────────────────────────────────────────────────────────────────── */

export function BookErrandIllustration({
  size = 240,
  style,
}: IllustrationProps) {
  return (
    <View style={[styles.wrap, style]}>
      <Stage size={size}>
        {/* Floating chips behind the phone */}
        <G opacity={0.95}>
          <Rect
            x="38"
            y="78"
            width="72"
            height="40"
            rx="14"
            fill={PALETTE.paper}
            stroke={PALETTE.primary200}
            strokeWidth="2"
          />
          <Circle cx="58" cy="98" r="8" fill={PALETTE.primary100} />
          <Path
            d="M54 98c0-3 3-5 6-2 3-3 6-1 6 2 0 4-6 7-6 7s-6-3-6-7Z"
            fill={PALETTE.primary600}
          />
          <Rect
            x="74"
            y="92"
            width="28"
            height="5"
            rx="2.5"
            fill={PALETTE.primary600}
          />
          <Rect
            x="74"
            y="103"
            width="20"
            height="4"
            rx="2"
            fill={PALETTE.primary200}
          />
        </G>
        <G opacity={0.95}>
          <Rect
            x="218"
            y="62"
            width="68"
            height="38"
            rx="13"
            fill={PALETTE.paper}
            stroke={PALETTE.primary200}
            strokeWidth="2"
          />
          <Circle cx="236" cy="81" r="7" fill={PALETTE.primary100} />
          <Path
            d="M232 80h8M236 76v8"
            stroke={PALETTE.primary600}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <Rect
            x="250"
            y="74"
            width="28"
            height="5"
            rx="2.5"
            fill={PALETTE.primary600}
          />
          <Rect
            x="250"
            y="84"
            width="20"
            height="4"
            rx="2"
            fill={PALETTE.primary200}
          />
        </G>
        <G opacity={0.95}>
          <Rect
            x="226"
            y="178"
            width="68"
            height="38"
            rx="13"
            fill={PALETTE.paper}
            stroke={PALETTE.primary200}
            strokeWidth="2"
          />
          <Circle cx="244" cy="197" r="7" fill={PALETTE.primary100} />
          <Path
            d="M240 200c2-4 6-4 8-1 2-3 6-3 8 1"
            stroke={PALETTE.primary600}
            strokeWidth="2.4"
            strokeLinecap="round"
            fill="none"
          />
          <Rect
            x="258"
            y="190"
            width="28"
            height="5"
            rx="2.5"
            fill={PALETTE.primary600}
          />
          <Rect
            x="258"
            y="200"
            width="20"
            height="4"
            rx="2"
            fill={PALETTE.primary200}
          />
        </G>

        {/* Phone frame */}
        <G>
          <Rect
            x="108"
            y="58"
            width="104"
            height="200"
            rx="22"
            fill={PALETTE.ink}
          />
          <Rect
            x="114"
            y="64"
            width="92"
            height="188"
            rx="18"
            fill="url(#paperHi)"
          />
          {/* Notch */}
          <Rect
            x="148"
            y="68"
            width="24"
            height="6"
            rx="3"
            fill={PALETTE.ink}
          />
          {/* Header pill */}
          <Rect
            x="124"
            y="86"
            width="72"
            height="28"
            rx="10"
            fill="url(#cardBlue)"
          />
          <Rect
            x="132"
            y="95"
            width="40"
            height="4"
            rx="2"
            fill="#FFFFFF"
            opacity={0.9}
          />
          <Rect
            x="132"
            y="103"
            width="28"
            height="3"
            rx="1.5"
            fill="#FFFFFF"
            opacity={0.6}
          />

          {/* Errand grid */}
          <Rect
            x="124"
            y="124"
            width="34"
            height="34"
            rx="10"
            fill={PALETTE.primary50}
          />
          <Rect
            x="138"
            y="138"
            width="6"
            height="6"
            rx="3"
            fill={PALETTE.primary600}
          />
          <Rect
            x="162"
            y="124"
            width="34"
            height="34"
            rx="10"
            fill={PALETTE.primary50}
          />
          <Path
            d="M173 142h12M179 136v12"
            stroke={PALETTE.primary600}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <Rect
            x="124"
            y="162"
            width="34"
            height="34"
            rx="10"
            fill={PALETTE.primary50}
          />
          <Circle cx="141" cy="179" r="5" fill={PALETTE.primary600} />
          <Rect
            x="162"
            y="162"
            width="34"
            height="34"
            rx="10"
            fill={PALETTE.primary50}
          />
          <Path
            d="M170 180c4-6 14-6 18 0"
            stroke={PALETTE.primary600}
            strokeWidth="2.4"
            strokeLinecap="round"
            fill="none"
          />

          {/* CTA bar */}
          <Rect
            x="124"
            y="208"
            width="72"
            height="28"
            rx="14"
            fill={PALETTE.primary600}
          />
          <Rect
            x="146"
            y="219"
            width="28"
            height="6"
            rx="3"
            fill="#FFFFFF"
          />
        </G>

        {/* Spark accent */}
        <Circle cx="208" cy="60" r="6" fill={PALETTE.accent} />
        <Path
          d="M208 50v-6M208 76v-4M218 60h-4M198 60h-4"
          stroke={PALETTE.accent}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </Stage>
    </View>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * 2. Real-time tracking — map with route, pins, and a runner
 * ────────────────────────────────────────────────────────────────── */

export function TrackingIllustration({
  size = 240,
  style,
}: IllustrationProps) {
  return (
    <View style={[styles.wrap, style]}>
      <Stage size={size}>
        {/* Map surface */}
        <G>
          <Rect
            x="48"
            y="74"
            width="224"
            height="160"
            rx="22"
            fill={PALETTE.paper}
            stroke={PALETTE.primary100}
            strokeWidth="2"
          />
          {/* Subtle road grid */}
          <Path
            d="M64 110h192M64 142h192M64 174h192M64 206h192"
            stroke={PALETTE.primary50}
            strokeWidth="6"
            strokeLinecap="round"
          />
          <Path
            d="M104 90v128M168 90v128M232 90v128"
            stroke={PALETTE.primary50}
            strokeWidth="6"
            strokeLinecap="round"
          />
          {/* Animated-feel route */}
          <Path
            d="M82 200c14-2 26-22 50-22s30 18 52 12 28-30 50-30"
            stroke={PALETTE.primary600}
            strokeWidth="5"
            strokeLinecap="round"
            fill="none"
          />
          <Path
            d="M82 200c14-2 26-22 50-22s30 18 52 12 28-30 50-30"
            stroke="#FFFFFF"
            strokeWidth="2"
            strokeDasharray="2 6"
            strokeLinecap="round"
            fill="none"
          />

          {/* Origin pin */}
          <Circle
            cx="82"
            cy="200"
            r="9"
            fill="#FFFFFF"
            stroke={PALETTE.primary600}
            strokeWidth="3"
          />
          {/* Destination pin */}
          <G>
            <Path
              d="M234 132c0-10 8-18 18-18s18 8 18 18c0 14-18 30-18 30s-18-16-18-30Z"
              fill={PALETTE.primary600}
            />
            <Circle cx="252" cy="132" r="6" fill="#FFFFFF" />
          </G>
        </G>

        {/* Runner avatar moving along the route */}
        <G>
          <Circle
            cx="170"
            cy="170"
            r="18"
            fill="#FFFFFF"
            stroke={PALETTE.primary600}
            strokeWidth="3"
          />
          <Circle cx="170" cy="164" r="6" fill={PALETTE.primary600} />
          <Path
            d="M158 180c2-6 8-9 12-9s10 3 12 9"
            stroke={PALETTE.primary600}
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
          {/* Live ping */}
          <Circle
            cx="170"
            cy="170"
            r="26"
            stroke={PALETTE.primary400}
            strokeWidth="2"
            opacity={0.45}
          />
          <Circle
            cx="170"
            cy="170"
            r="34"
            stroke={PALETTE.primary300}
            strokeWidth="2"
            opacity={0.25}
          />
        </G>

        {/* ETA card */}
        <G>
          <Rect
            x="60"
            y="58"
            width="118"
            height="34"
            rx="12"
            fill="#FFFFFF"
            stroke={PALETTE.primary100}
            strokeWidth="2"
          />
          <Circle cx="78" cy="75" r="9" fill={PALETTE.primary50} />
          <Path
            d="M78 70v6l4 2"
            stroke={PALETTE.primary600}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <Rect
            x="94"
            y="68"
            width="56"
            height="5"
            rx="2.5"
            fill={PALETTE.primary600}
          />
          <Rect
            x="94"
            y="78"
            width="38"
            height="4"
            rx="2"
            fill={PALETTE.primary200}
          />
        </G>

        {/* Spark */}
        <Circle cx="60" cy="240" r="5" fill={PALETTE.accent} />
      </Stage>
    </View>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * 3. Safe & secure — shield, verified runner, lock
 * ────────────────────────────────────────────────────────────────── */

export function SafetyIllustration({
  size = 240,
  style,
}: IllustrationProps) {
  return (
    <View style={[styles.wrap, style]}>
      <Stage size={size}>
        {/* Shield */}
        <G>
          <Path
            d="M160 60 88 92v60c0 44 32 78 72 92 40-14 72-48 72-92V92l-72-32Z"
            fill="url(#cardBlue)"
          />
          <Path
            d="M160 60 88 92v60c0 44 32 78 72 92 40-14 72-48 72-92V92l-72-32Z"
            stroke={PALETTE.primary800}
            strokeWidth="2"
            opacity={0.4}
          />
          {/* Inner highlight */}
          <Path
            d="M160 80 108 102v50c0 36 26 64 52 76V80Z"
            fill="#FFFFFF"
            opacity={0.08}
          />
          {/* Check */}
          <Path
            d="M128 158l24 24 44-50"
            stroke="#FFFFFF"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </G>

        {/* Verified avatar bubble (top right) */}
        <G>
          <Circle cx="246" cy="92" r="26" fill="#FFFFFF" />
          <Circle
            cx="246"
            cy="92"
            r="26"
            stroke={PALETTE.primary100}
            strokeWidth="2"
          />
          <Circle cx="246" cy="86" r="8" fill={PALETTE.primary600} />
          <Path
            d="M232 108c2-8 8-12 14-12s12 4 14 12"
            stroke={PALETTE.primary600}
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
          {/* Verified badge */}
          <Circle cx="266" cy="76" r="10" fill={PALETTE.success} />
          <Path
            d="M261 76l4 4 6-8"
            stroke="#FFFFFF"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </G>

        {/* Lock chip (bottom left) */}
        <G>
          <Rect
            x="48"
            y="200"
            width="78"
            height="36"
            rx="14"
            fill="#FFFFFF"
            stroke={PALETTE.primary100}
            strokeWidth="2"
          />
          <Rect
            x="60"
            y="208"
            width="20"
            height="20"
            rx="6"
            fill={PALETTE.primary600}
          />
          <Path
            d="M64 208v-3a6 6 0 0 1 12 0v3"
            stroke={PALETTE.primary600}
            strokeWidth="2.4"
            strokeLinecap="round"
            fill="none"
          />
          <Circle cx="70" cy="218" r="2" fill="#FFFFFF" />
          <Rect
            x="88"
            y="212"
            width="32"
            height="5"
            rx="2.5"
            fill={PALETTE.primary600}
          />
          <Rect
            x="88"
            y="222"
            width="22"
            height="4"
            rx="2"
            fill={PALETTE.primary200}
          />
        </G>

        {/* Sparkles */}
        <Circle cx="76" cy="78" r="4" fill={PALETTE.accent} />
        <Circle cx="284" cy="186" r="5" fill={PALETTE.accent} />
      </Stage>
    </View>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Bonus: small brand mark for auth screens (login / register hero).
 * Used by login & register where we want a calmer, single-element
 * visual instead of a full carousel illustration.
 * ────────────────────────────────────────────────────────────────── */

export function AuthBrandMark({
  size = 96,
  style,
  tintColor,
}: IllustrationProps & { tintColor?: string }) {
  return (
    <View style={[styles.wrap, style]}>
      <Image
        source={require('../../../assets/logo-new.png')}
        style={[{ width: size, height: size }, tintColor ? { tintColor } : null]}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={0}
      />
    </View>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * 4. Location empty state — pin on a map. Used wherever we need an
 * "add an address" / "no saved addresses" / "pick a destination"
 * cue (saved addresses, location picker empty state, etc.).
 * ────────────────────────────────────────────────────────────────── */

export function LocationIllustration({
  size = 200,
  style,
}: IllustrationProps) {
  return (
    <View style={[styles.wrap, style]}>
      <Stage size={size}>
        {/* Compact map plate */}
        <G>
          <Rect
            x="56"
            y="98"
            width="208"
            height="132"
            rx="22"
            fill={PALETTE.paper}
            stroke={PALETTE.primary100}
            strokeWidth="2"
          />
          <Path
            d="M70 130h180M70 162h180M70 198h180"
            stroke={PALETTE.primary50}
            strokeWidth="6"
            strokeLinecap="round"
          />
          <Path
            d="M120 110v110M196 110v110"
            stroke={PALETTE.primary50}
            strokeWidth="6"
            strokeLinecap="round"
          />
          {/* Park */}
          <Rect
            x="70"
            y="170"
            width="44"
            height="28"
            rx="6"
            fill={PALETTE.primary100}
            opacity={0.7}
          />
        </G>

        {/* Big drop pin */}
        <G>
          <Ellipse
            cx="160"
            cy="216"
            rx="22"
            ry="6"
            fill={PALETTE.shadow}
          />
          <Path
            d="M160 96c-22 0-40 17-40 38 0 28 40 78 40 78s40-50 40-78c0-21-18-38-40-38Z"
            fill="url(#cardBlue)"
            stroke={PALETTE.primary800}
            strokeWidth="2"
          />
          <Circle cx="160" cy="134" r="14" fill="#FFFFFF" />
          <Circle cx="160" cy="134" r="6" fill={PALETTE.primary600} />
        </G>

        {/* Floating address chip */}
        <G>
          <Rect
            x="62"
            y="62"
            width="146"
            height="34"
            rx="12"
            fill="#FFFFFF"
            stroke={PALETTE.primary100}
            strokeWidth="2"
          />
          <Circle cx="80" cy="79" r="8" fill={PALETTE.primary50} />
          <Circle cx="80" cy="79" r="3.5" fill={PALETTE.primary600} />
          <Rect
            x="96"
            y="72"
            width="92"
            height="5"
            rx="2.5"
            fill={PALETTE.primary600}
          />
          <Rect
            x="96"
            y="82"
            width="64"
            height="4"
            rx="2"
            fill={PALETTE.primary200}
          />
        </G>

        <Circle cx="252" cy="78" r="5" fill={PALETTE.accent} />
      </Stage>
    </View>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * 5. Contact empty state — silhouette + plus. Used by trusted
 * contacts / saved recipients screens when the list is empty.
 * ────────────────────────────────────────────────────────────────── */

export function ContactIllustration({
  size = 200,
  style,
}: IllustrationProps) {
  return (
    <View style={[styles.wrap, style]}>
      <Stage size={size}>
        {/* Contact card behind */}
        <G>
          <Rect
            x="62"
            y="92"
            width="196"
            height="120"
            rx="22"
            fill={PALETTE.paper}
            stroke={PALETTE.primary100}
            strokeWidth="2"
          />
          {/* Avatar disc */}
          <Circle cx="116" cy="148" r="34" fill="url(#cardBlue)" />
          <Circle cx="116" cy="138" r="12" fill="#FFFFFF" />
          <Path
            d="M94 170c4-12 14-18 22-18s18 6 22 18"
            stroke="#FFFFFF"
            strokeWidth="6"
            strokeLinecap="round"
            fill="none"
          />
          {/* Lines */}
          <Rect
            x="170"
            y="124"
            width="74"
            height="8"
            rx="4"
            fill={PALETTE.primary600}
          />
          <Rect
            x="170"
            y="142"
            width="58"
            height="6"
            rx="3"
            fill={PALETTE.primary200}
          />
          <Rect
            x="170"
            y="158"
            width="48"
            height="6"
            rx="3"
            fill={PALETTE.primary200}
          />
          <Rect
            x="170"
            y="178"
            width="64"
            height="14"
            rx="7"
            fill={PALETTE.primary50}
            stroke={PALETTE.primary200}
            strokeWidth="1.5"
          />
          <Path
            d="M178 185h12M184 179v12"
            stroke={PALETTE.primary600}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </G>

        {/* "Add" badge */}
        <G>
          <Circle cx="244" cy="92" r="22" fill={PALETTE.success} />
          <Path
            d="M236 92h16M244 84v16"
            stroke="#FFFFFF"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </G>

        <Circle cx="68" cy="76" r="5" fill={PALETTE.accent} />
      </Stage>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
