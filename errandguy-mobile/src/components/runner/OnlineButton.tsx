import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MotiView } from 'moti';
import { Power, MapPin, AlertTriangle } from 'lucide-react-native';
import { toast } from '../../stores/toastStore';

interface OnlineButtonProps {
  isOnline: boolean;
  loading?: boolean;
  disabled?: boolean;
  /** Reason the button is disabled — surfaced to users on tap. */
  disabledReason?: string;
  /** When provided, shown beneath the button (e.g. location warning). */
  hint?: string;
  /** Optional secondary action (e.g. "Enable location"). */
  hintAction?: { label: string; onPress: () => void };
  onToggle: (next: boolean) => void;
}

// Toggle palette — matches the system blue used everywhere else.
//   OFF  → mostly white, blue border + blue icon (a "ready" state).
//   ON   → solid theme blue, white icon, soft blue glow.
//   LOCK → muted grey when verification is pending.
const PRIMARY = '#2563EB';      // theme primary
const PRIMARY_SOFT = '#DBEAFE'; // primary-100, halo when on
const OFF_BG = '#FFFFFF';
const OFF_FG = '#2563EB';
const OFF_BORDER = '#BFDBFE';   // blue-200, subtle
const ON_BG = PRIMARY;
const ON_FG = '#FFFFFF';
const LOCKED_BG = '#F1F5F9';    // slate-100
const LOCKED_FG = '#94A3B8';    // slate-400
const LOCKED_BORDER = '#E2E8F0';

/**
 * The runner home's primary CTA — a large, centred power button.
 *
 * Design notes
 *  - No decorative outer rings or halos: the screen stays calm so the
 *    button itself is the focal point.
 *  - State transitions (offline → online) animate the background colour
 *    smoothly via Moti so the change feels intentional, not a hard cut.
 *  - All colours and font weights are set inline (not via NativeWind
 *    classes) so the design renders identically on iOS and Android even
 *    when the className-to-style pipeline misbehaves.
 */
export function OnlineButton({
  isOnline,
  loading,
  disabled,
  disabledReason,
  hint,
  hintAction,
  onToggle,
}: OnlineButtonProps) {
  const handlePress = () => {
    if (loading) return;
    if (disabled) {
      if (disabledReason) toast.warning(disabledReason);
      return;
    }
    onToggle(!isOnline);
  };

  const accent = disabled ? LOCKED_FG : isOnline ? ON_BG : OFF_FG;
  const subLabel = disabled
    ? 'Verification required'
    : isOnline
    ? 'You are online — receiving requests'
    : 'You are offline — tap to start';

  // Animated values resolved per state. Keeping them as plain locals
  // (not derived in render JSX) makes the Moti animate prop a single
  // declarative object, which produces a smooth simultaneous tween of
  // background + border + icon colour.
  const bg = disabled ? LOCKED_BG : isOnline ? ON_BG : OFF_BG;
  const border = disabled ? LOCKED_BORDER : isOnline ? ON_BG : OFF_BORDER;
  const iconColor = disabled ? LOCKED_FG : isOnline ? ON_FG : OFF_FG;

  return (
    <View style={styles.wrap}>
      {/* Soft "smokey" glow behind the button when ONLINE. We render a
          plain blurred-shadow view (no border ring this time — the user
          felt the ring was too literal) and animate its opacity gently
          so the on-state radiates without dominating. */}
      <MotiView
        animate={{
          opacity: isOnline && !disabled ? 0.55 : 0,
          scale: isOnline && !disabled ? 1 : 0.9,
        }}
        transition={{ type: 'timing', duration: 480 }}
        pointerEvents="none"
        style={styles.halo}
      />
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={isOnline ? 'Turn off — go offline' : 'Turn on — go online'}
        accessibilityState={{ disabled: !!disabled, busy: !!loading }}
        android_ripple={{
          color: isOnline ? 'rgba(255,255,255,0.18)' : 'rgba(37,99,235,0.12)',
          borderless: true,
          radius: 92,
        }}
        style={({ pressed }) => [
          styles.pressable,
          { transform: [{ scale: pressed ? 0.97 : 1 }] },
        ]}
      >
        {/* Animated colour layer — Moti tweens background, border and
            shadow in lockstep so OFF→ON feels like one fluid "fill"
            sweep with a slight ease so it's perceptibly smooth, not
            snappy. */}
        <MotiView
          animate={{
            backgroundColor: bg,
            borderColor: border,
            shadowOpacity: disabled ? 0.05 : isOnline ? 0.35 : 0.1,
          }}
          transition={{ type: 'timing', duration: 420 }}
          style={[
            styles.button,
            {
              shadowColor: isOnline ? PRIMARY : '#0F172A',
            },
          ]}
        >
          {/* Inner pulse — when ONLINE, a faint expanding ring breathes
              behind the icon so the "live" state feels alive without
              being noisy. Hidden when OFF. */}
          {isOnline && !disabled && !loading && (
            <MotiView
              from={{ opacity: 0.35, scale: 0.6 }}
              animate={{ opacity: 0, scale: 1.4 }}
              transition={{ type: 'timing', duration: 1600, loop: true, repeatReverse: false }}
              pointerEvents="none"
              style={styles.pulse}
            />
          )}

          {loading ? (
            // Replaces the plain ActivityIndicator with a smooth
            // breathing dot so the wait reads as "thinking" rather
            // than the harsh stock spinner.
            <MotiView
              from={{ opacity: 0.4, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1.05 }}
              transition={{ type: 'timing', duration: 700, loop: true, repeatReverse: true }}
              style={[
                styles.loadingDot,
                { backgroundColor: isOnline ? ON_FG : OFF_FG },
              ]}
            />
          ) : (
            <MotiView
              animate={{ scale: isOnline ? 1.05 : 1, rotate: isOnline ? '0deg' : '0deg' }}
              transition={{ type: 'timing', duration: 320 }}
            >
              <Power size={84} color={iconColor} strokeWidth={2.6} />
            </MotiView>
          )}
        </MotiView>
      </Pressable>

      {/* Plain-text status under the button so the colour isn't the only signal. */}
      <Text style={[styles.subLabel, { color: accent }]}>{subLabel}</Text>

      {hint ? (
        <View style={styles.hintBox}>
          <AlertTriangle size={14} color="#B45309" />
          <Text style={styles.hintText}>{hint}</Text>
          {hintAction && (
            <Pressable hitSlop={8} onPress={hintAction.onPress}>
              <Text style={styles.hintAction}>{hintAction.label}</Text>
            </Pressable>
          )}
        </View>
      ) : !disabled && !isOnline ? (
        <View style={styles.gpsRow}>
          <MapPin size={11} color="#94A3B8" />
          <Text style={styles.gpsText}>Location is shared only while online</Text>
        </View>
      ) : null}
    </View>
  );
}

const BUTTON_SIZE = 184;
const HALO_SIZE = BUTTON_SIZE + 20;

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  halo: {
    position: 'absolute',
    // Center the halo on the button. Wrap has paddingTop:8 and the
    // button itself is BUTTON_SIZE; the halo is HALO_SIZE so we shift
    // up by half the size delta so both share a vertical center.
    top: 8 - (HALO_SIZE - BUTTON_SIZE) / 2,
    width: HALO_SIZE,
    height: HALO_SIZE,
    borderRadius: HALO_SIZE / 2,
    // No border ring — we keep ONLY the soft drop-shadow so the on
    // state reads as a gentle blue "smoke" rather than a hard ring.
    backgroundColor: PRIMARY_SOFT,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 38,
    elevation: 0,
  },
  pulse: {
    position: 'absolute',
    width: BUTTON_SIZE - 16,
    height: BUTTON_SIZE - 16,
    borderRadius: (BUTTON_SIZE - 16) / 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  loadingDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  pressable: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    // shadow (iOS) — colour swapped per state in render so OFF is a
    // soft black drop-shadow and ON glows in cyan.
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.32,
    shadowRadius: 26,
    // elevation (Android)
    elevation: 12,
  },
  buttonLabel: {
    // Kept in the StyleSheet but no longer rendered — the icon now
    // carries the affordance on its own. Removed from the JSX so the
    // big circle stays clean.
    display: 'none',
  },
  subLabel: {
    marginTop: 14,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  hintBox: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 320,
  },
  hintText: {
    flex: 1,
    fontSize: 12,
    color: '#92400E',
    fontWeight: '500',
  },
  hintAction: {
    fontSize: 12,
    fontWeight: '700',
    color: '#78350F',
    textDecorationLine: 'underline',
  },
  gpsRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  gpsText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
});
