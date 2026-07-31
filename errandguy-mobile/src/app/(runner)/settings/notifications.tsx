import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Switch, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Bell, MessageSquare, Star, AlertTriangle, Lock } from 'lucide-react-native';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Card } from '../../../components/ui/Card';
import { LightColors } from '../../../constants/colors';
import { useResponsive } from '../../../constants/responsive';
import { useAuthStore } from '../../../stores/authStore';
import { storage } from '../../../utils/storage';
import type { LucideIcon } from 'lucide-react-native';

interface NotifPref {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Safety alerts can never be turned off — the switch is locked ON. */
  locked?: boolean;
}

const PREFERENCES: NotifPref[] = [
  {
    key: 'new_errands',
    label: 'New Errand Requests',
    description: 'Get notified when a new errand is available',
    icon: Bell,
  },
  {
    key: 'messages',
    label: 'Chat Messages',
    description: 'Notifications for customer messages',
    icon: MessageSquare,
  },
  {
    key: 'reviews',
    label: 'Reviews & Ratings',
    description: 'Know when a customer leaves a review',
    icon: Star,
  },
  {
    key: 'alerts',
    label: 'Safety Alerts',
    description: 'Important safety and emergency notifications',
    icon: AlertTriangle,
    locked: true,
  },
];

const DEFAULT_PREFS: Record<string, boolean> = {
  new_errands: true,
  messages: true,
  reviews: true,
  alerts: true,
};

// Per-user so switching accounts on the same device doesn't leak one
// runner's preferences into another's.
const prefsKey = (userId: string) => `runner_notif_prefs:${userId}`;

export default function NotificationsScreen() {
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const { contentMaxWidth } = useResponsive();
  // `null` until the persisted read resolves — rendering a skeleton until
  // then avoids briefly flashing default-ON toggle positions for a runner
  // who previously turned a pref off.
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);

  // Load persisted preferences on mount so toggles survive remounts —
  // previously they were pure component state and silently reset every
  // time the screen was reopened.
  useEffect(() => {
    let cancelled = false;
    setPrefs(null);
    (async () => {
      const saved = await storage.getJSON<Record<string, boolean>>(prefsKey(userId));
      if (cancelled) return;
      // Merge over defaults (future keys get sane values) and force the
      // locked safety-alerts switch ON regardless of what was stored.
      setPrefs(saved ? { ...DEFAULT_PREFS, ...saved, alerts: true } : DEFAULT_PREFS);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const toggle = (key: string) => {
    Haptics.selectionAsync().catch(() => {});
    setPrefs((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: !prev[key], alerts: true };
      // Fire-and-forget persist — AsyncStorage write failures shouldn't
      // block the UI, and the state already reflects the user's intent.
      storage.setJSON(prefsKey(userId), next).catch(() => {});
      return next;
    });
  };

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Notification Preferences" showBack fallbackHref="/(runner)/(tabs)/profile" />

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
        {prefs ? (
          <Card className="p-0 overflow-hidden">
            {PREFERENCES.map((pref, idx) => {
              const isOn = pref.locked ? true : !!prefs[pref.key];
              const borderCls = idx < PREFERENCES.length - 1 ? 'border-b border-divider' : '';
              // Reviews & Ratings is a brand-gold reward moment, not a status —
              // its chip wears the accent wash + dense gold star glyph. Every
              // other row stays blue.
              const isReviews = pref.key === 'reviews';
              const rowBody = (
                <>
                  <View className="flex-row items-center gap-3 flex-1 mr-3">
                    <View
                      className={`w-10 h-10 rounded-full items-center justify-center ${
                        isReviews ? 'bg-accentSoft' : 'bg-surfaceMuted'
                      }`}
                    >
                      <pref.icon
                        size={18}
                        color={isReviews ? LightColors.accentStrong : LightColors.primary}
                        strokeWidth={1.8}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-[14px] font-montserrat-semi text-textPrimary">
                        {pref.label}
                      </Text>
                      <Text className="text-sm font-montserrat text-textSecondary mt-0.5">
                        {pref.description}
                      </Text>
                      {pref.locked && (
                        <View className="flex-row items-center gap-1 mt-1">
                          <Lock size={11} color={LightColors.textTertiary} strokeWidth={2} />
                          <Text className="text-xs font-montserrat text-textTertiary">
                            Always on for your safety
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  {/* Switch is a visual indicator only — the whole row owns the
                      touch + a11y (role=switch). Dim the locked one so it reads
                      as non-interactive; RN doesn't dim a disabled Switch. */}
                  <View
                    pointerEvents="none"
                    importantForAccessibility="no-hide-descendants"
                    style={pref.locked ? { opacity: 0.5 } : undefined}
                  >
                    <Switch
                      value={isOn}
                      trackColor={{ false: LightColors.dividerStrong, true: LightColors.primaryMuted }}
                      thumbColor={isOn ? LightColors.primary : LightColors.surface}
                    />
                  </View>
                </>
              );

              if (pref.locked) {
                return (
                  <View
                    key={pref.key}
                    className={`flex-row items-center justify-between p-4 ${borderCls}`}
                    accessibilityRole="switch"
                    accessibilityLabel={pref.label}
                    accessibilityState={{ checked: true, disabled: true }}
                    accessibilityHint="Always on. Safety alerts cannot be disabled for your protection."
                  >
                    {rowBody}
                  </View>
                );
              }

              return (
                <Pressable
                  key={pref.key}
                  onPress={() => toggle(pref.key)}
                  className={`flex-row items-center justify-between p-4 ${borderCls}`}
                  android_ripple={{ color: `${LightColors.primary}14` }}
                  accessibilityRole="switch"
                  accessibilityLabel={pref.label}
                  accessibilityState={{ checked: isOn }}
                  style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
                >
                  {rowBody}
                </Pressable>
              );
            })}
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            {PREFERENCES.map((pref, idx) => (
              <View
                key={pref.key}
                className={`flex-row items-center justify-between p-4 ${
                  idx < PREFERENCES.length - 1 ? 'border-b border-divider' : ''
                }`}
              >
                <View className="flex-row items-center gap-3 flex-1 mr-3">
                  <View className="w-10 h-10 rounded-full bg-divider" />
                  <View className="flex-1 gap-1.5">
                    <View className="h-3 rounded bg-divider" style={{ width: '52%' }} />
                    <View className="h-2.5 rounded bg-divider" style={{ width: '78%' }} />
                  </View>
                </View>
                <View className="w-[51px] h-[31px] rounded-full bg-divider" />
              </View>
            ))}
          </Card>
        )}

        <Text className="text-xs font-montserrat text-textSecondary mt-4 text-center px-4">
          Safety alerts cannot be fully disabled for your protection.
        </Text>
      </ScrollView>
    </View>
  );
}
