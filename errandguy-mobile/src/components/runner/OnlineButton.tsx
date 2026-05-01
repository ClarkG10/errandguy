import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
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

const OFFLINE = '#2563EB';
const ONLINE = '#16A34A';
const LOCKED = '#94A3B8';

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

  const accent = disabled ? LOCKED : isOnline ? ONLINE : OFFLINE;
  const label = loading ? '' : isOnline ? 'TURN OFF' : 'TURN ON';
  const subLabel = disabled
    ? 'Verification required'
    : isOnline
    ? 'You are online — receiving requests'
    : 'You are offline — tap to start';

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={isOnline ? 'Turn off — go offline' : 'Turn on — go online'}
        accessibilityState={{ disabled: !!disabled, busy: !!loading }}
        android_ripple={{ color: 'rgba(255,255,255,0.18)', borderless: true, radius: 92 }}
        style={({ pressed }) => [
          styles.pressable,
          { transform: [{ scale: pressed ? 0.97 : 1 }] },
        ]}
      >
        {/* Animated colour layer — Moti tweens the backgroundColor
            smoothly between the offline / online / locked accents. */}
        <MotiView
          animate={{
            backgroundColor: accent,
            shadowOpacity: disabled ? 0.12 : 0.32,
          }}
          transition={{ type: 'timing', duration: 350 }}
          style={[
            styles.button,
            {
              shadowColor: accent,
            },
          ]}
        >
          {loading ? (
            <ActivityIndicator size="large" color="#FFFFFF" />
          ) : (
            <>
              <Power size={56} color="#FFFFFF" strokeWidth={2.4} />
              <Text style={styles.buttonLabel}>{label}</Text>
            </>
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

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
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
    // shadow (iOS)
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.32,
    shadowRadius: 24,
    // elevation (Android)
    elevation: 12,
  },
  buttonLabel: {
    marginTop: 8,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2.5,
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
