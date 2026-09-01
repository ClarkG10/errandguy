import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, AppState, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Bell, BellOff, MessageSquare, Star, AlertTriangle, Lock } from 'lucide-react-native';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { LightColors } from '../../../constants/colors';
import { useResponsive } from '../../../constants/responsive';
import { useAuthStore } from '../../../stores/authStore';
import { storage } from '../../../utils/storage';
import type { LucideIcon } from 'lucide-react-native';

/**
 * WHY THIS SCREEN HAS NO PER-CATEGORY SWITCHES.
 *
 * It used to ship four toggles (new errands / messages / reviews / safety).
 * They persisted to AsyncStorage under `runner_notif_prefs:<userId>` and
 * NOTHING read them — not the app, not the push handler, not the server.
 * There is no notification-preference column, no endpoint, and no check in
 * NotificationService or SendPushJob, so a runner who switched "Chat
 * Messages" off kept being buzzed for every message. A control that
 * silently does nothing is worse than no control, so the switches are gone.
 *
 * They cannot be made real from the app either: these are REMOTE pushes.
 * Once Expo/FCM/APNs hands the payload to the OS, the OS decides whether
 * to buzz — a JS-side flag can only affect the FOREGROUND presentation
 * (`setNotificationHandler` in src/hooks/useNotifications.ts), which would
 * mute the banner while the phone still buzzed in the runner's pocket.
 * That is a second, subtler lie.
 *
 * What IS real today is the OS-level switch, so that is what this screen
 * offers: the live permission state plus a one-tap route to it. The rows
 * below are informational — they tell the runner what ErrandGuy sends.
 *
 * To bring per-category control back for real, either:
 *  (a) add a nullable JSON `notification_prefs` column on users, accept it
 *      on the profile-update endpoint, and have NotificationService gate
 *      only the DEVICE-PUSH leg (in-app rows + the Reverb broadcast must
 *      stay, or a muted runner silently stops seeing work); or
 *  (b) give each notification type its own Android notification channel
 *      (server sets Expo's `channelId`, the app creates the channels in
 *      useNotifications.ts) — then Android's own per-channel settings do
 *      the job with no preference storage at all.
 * Safety/SOS must never be gated by either.
 */

interface NotifKind {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Safety alerts are never suppressed, whatever else is muted. */
  locked?: boolean;
}

const KINDS: NotifKind[] = [
  {
    key: 'new_errands',
    label: 'New Errand Requests',
    description: 'A new errand near you is up for grabs, or one was offered to you directly',
    icon: Bell,
  },
  {
    key: 'messages',
    label: 'Chat Messages',
    description: 'A customer messaged you about an errand in progress',
    icon: MessageSquare,
  },
  {
    key: 'reviews',
    label: 'Reviews & Ratings',
    description: 'A customer left you a rating after a completed errand',
    icon: Star,
  },
  {
    key: 'alerts',
    label: 'Safety Alerts',
    description: 'Emergency and safety notifications',
    icon: AlertTriangle,
    locked: true,
  },
];

// The dead per-user key the removed toggles wrote to. Cleared on mount so
// no future reader mistakes a stale toggle map for live configuration.
const legacyPrefsKey = (userId: string) => `runner_notif_prefs:${userId}`;

export default function NotificationsScreen() {
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const { contentMaxWidth } = useResponsive();
  // null = permission state not read yet (or unreadable, e.g. web/simulator);
  // the card renders a neutral line rather than guessing.
  const [granted, setGranted] = useState<boolean | null>(null);

  const readPermission = useCallback(async () => {
    try {
      const status = await Notifications.getPermissionsAsync();
      setGranted(!!status?.granted);
    } catch {
      setGranted(null);
    }
  }, []);

  useEffect(() => {
    void readPermission();
    // Re-read on foreground — the runner taps through to the OS settings
    // screen and comes back, and the card must reflect what they just did.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void readPermission();
    });
    return () => sub.remove();
  }, [readPermission]);

  useEffect(() => {
    storage.remove(legacyPrefsKey(userId)).catch(() => {});
  }, [userId]);

  const openDeviceSettings = useCallback(() => {
    Linking.openSettings().catch(() => {});
  }, []);

  const statusLine =
    granted === null
      ? 'Checking your device settings…'
      : granted
        ? 'Notifications are on for ErrandGuy.'
        : "Notifications are off. You won't be alerted about new errands, messages or safety alerts until you turn them back on.";

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Notifications" showBack fallbackHref="/(runner)/(tabs)/profile" />

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: 40,
          maxWidth: contentMaxWidth,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        {/* The one control on this screen that actually does something. */}
        <Card className={`p-4 ${granted === false ? 'bg-dangerSoft' : ''}`}>
          <View className="flex-row items-center gap-3">
            <View
              className={`w-10 h-10 rounded-full items-center justify-center ${
                granted === false ? 'bg-surface' : 'bg-surfaceMuted'
              }`}
            >
              {granted === false ? (
                <BellOff size={18} color={LightColors.dangerDark} strokeWidth={1.8} />
              ) : (
                <Bell size={18} color={LightColors.primary} strokeWidth={1.8} />
              )}
            </View>
            <View className="flex-1">
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">
                Device notifications
              </Text>
              <Text
                className={`text-sm font-montserrat mt-0.5 ${
                  granted === false ? 'text-dangerDark' : 'text-textSecondary'
                }`}
                accessibilityLiveRegion="polite"
              >
                {statusLine}
              </Text>
            </View>
          </View>

          <View className="mt-3">
            <Button
              title={granted === false ? 'Turn On Notifications' : 'Open Device Settings'}
              onPress={openDeviceSettings}
              variant={granted === false ? 'primary' : 'secondary'}
              size="sm"
              fullWidth
              accessibilityHint="Opens the ErrandGuy notification settings on your device"
            />
          </View>
        </Card>

        <Text className="text-sm font-montserrat-bold text-textSecondary mt-5 mb-2">
          What we send you
        </Text>

        <Card className="p-0 overflow-hidden">
          {KINDS.map((kind, idx) => {
            // Reviews & Ratings is a brand-gold reward moment, not a status —
            // its chip wears the accent wash + dense gold star glyph. Every
            // other row stays blue.
            const isReviews = kind.key === 'reviews';
            return (
              <View
                key={kind.key}
                className={`flex-row items-start p-4 ${
                  idx < KINDS.length - 1 ? 'border-b border-divider' : ''
                }`}
                accessibilityLabel={
                  kind.locked
                    ? `${kind.label}. ${kind.description}. Always on for your safety.`
                    : `${kind.label}. ${kind.description}.`
                }
              >
                <View
                  className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
                    isReviews ? 'bg-accentSoft' : 'bg-surfaceMuted'
                  }`}
                >
                  <kind.icon
                    size={18}
                    color={isReviews ? LightColors.accentStrong : LightColors.primary}
                    strokeWidth={1.8}
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-[14px] font-montserrat-semi text-textPrimary">
                    {kind.label}
                  </Text>
                  <Text className="text-sm font-montserrat text-textSecondary mt-0.5">
                    {kind.description}
                  </Text>
                  {kind.locked && (
                    <View className="flex-row items-center gap-1 mt-1">
                      <Lock size={11} color={LightColors.textTertiary} strokeWidth={2} />
                      <Text className="text-xs font-montserrat text-textTertiary">
                        Always on for your safety
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </Card>

        <Text className="text-xs font-montserrat text-textSecondary mt-4 leading-5">
          ErrandGuy can't mute these one at a time yet — your device's notification settings
          control all of them together. Safety alerts are always sent while notifications are on.
        </Text>
      </ScrollView>
    </View>
  );
}
