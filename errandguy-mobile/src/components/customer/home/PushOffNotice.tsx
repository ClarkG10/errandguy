import React, { useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  AppState,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { BellOff } from 'lucide-react-native';
import { useNotificationStore } from '../../../stores/notificationStore';
import { readPushPermission, turnOnPush } from '../../../services/pushPermission';
import { LightColors } from '../../../constants/colors';
import { Radius } from '../../../constants/radius';

interface PushOffNoticeProps {
  /** Hide it for now (the caller decides for how long). Omit to make it permanent. */
  onDismiss?: () => void;
  /** What still works without notifications, said in this screen's terms. */
  fallbackLine?: string;
  /** Outer spacing — applied only when the notice shows, so it never leaves a gap. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Pattern 7 (permission denied) for push notifications.
 *
 * Only once the phone has REFUSED notifications ('denied' — the OS prompt is
 * spent, so only Settings can undo it). While the prompt is still available
 * ('undetermined') the app's own NotificationPrimer asks instead, and nothing
 * shows here.
 *
 * Says why it matters, gives the way back (the phone's Settings, via
 * turnOnPush, which opens them once the prompt is used up) and what still
 * works without it. Re-reads the permission when the app comes back to the
 * foreground, so returning from Settings with notifications on clears it.
 */
export function PushOffNotice({
  onDismiss,
  fallbackLine = 'You can still follow every errand here while the app is open.',
  style,
}: PushOffNoticeProps) {
  const denied = useNotificationStore((s) => s.pushPermission === 'denied');

  useEffect(() => {
    void readPushPermission();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void readPushPermission();
    });
    return () => sub.remove();
  }, []);

  if (!denied) return null;

  return (
    <View
      style={[s.card, style]}
      accessibilityRole="summary"
      testID="push-off-notice"
    >
      <View style={s.row}>
        <View style={s.icon}>
          <BellOff size={18} color={LightColors.warningDark} strokeWidth={2} />
        </View>
        <View style={s.copy}>
          <Text style={s.title}>Notifications are off</Text>
          <Text style={s.body}>
            {`You won’t hear when a runner accepts, arrives or messages you. ${fallbackLine}`}
          </Text>
        </View>
      </View>
      <View style={s.actions}>
        <Pressable
          onPress={() => {
            void turnOnPush();
          }}
          accessibilityRole="button"
          accessibilityLabel="Allow notifications in Settings"
          hitSlop={4}
          className="active:opacity-70"
          style={s.primary}
        >
          <Text style={s.primaryText}>Allow in Settings</Text>
        </Pressable>
        {onDismiss ? (
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Not now"
            hitSlop={4}
            className="active:opacity-70"
            style={s.secondary}
          >
            <Text style={s.secondaryText}>Not now</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: LightColors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: LightColors.divider,
    padding: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: LightColors.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    marginLeft: 12,
  },
  title: {
    fontSize: 14,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textPrimary,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textSecondary,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  primary: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: Radius.control,
    backgroundColor: LightColors.primary50,
    justifyContent: 'center',
  },
  primaryText: {
    fontSize: 13,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.primary,
  },
  secondary: {
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  secondaryText: {
    fontSize: 13,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textSecondary,
  },
});
