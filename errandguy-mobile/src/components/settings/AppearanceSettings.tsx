import React from 'react';
import { View, Text, ScrollView, Switch, Pressable } from 'react-native';
import { Sparkles, Vibrate } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Card } from '../ui/Card';
import { Eyebrow } from '../ui/Typography';
import { LightColors } from '../../constants/colors';
import { useResponsive } from '../../constants/responsive';
import { haptics } from '../../utils/haptics';
import { usePreferencesStore } from '../../stores/preferencesStore';

/**
 * Shared body for the Appearance & Accessibility screen, rendered by both the
 * customer and runner route wrappers (each supplies its own GradientHeader).
 *
 * Everything here is device-local comfort tuning, so the chrome stays neutral:
 * surfaceMuted icon chips with blue glyphs, blue as the only active colour. No
 * accent gold (that family is rewards/earnings/ratings only) and no warning
 * amber (nothing here is a caution).
 */

interface ToggleRow {
  key: 'reduceMotion' | 'reduceHaptics';
  label: string;
  description: string;
  icon: LucideIcon;
  value: boolean;
  onToggle: (next: boolean) => void;
}

export function AppearanceSettings() {
  const { contentMaxWidth } = useResponsive();

  const reduceMotionOverride = usePreferencesStore((s) => s.reduceMotionOverride);
  const reduceHaptics = usePreferencesStore((s) => s.reduceHaptics);
  const setReduceMotionOverride = usePreferencesStore((s) => s.setReduceMotionOverride);
  const setReduceHaptics = usePreferencesStore((s) => s.setReduceHaptics);

  const rows: ToggleRow[] = [
    {
      key: 'reduceMotion',
      label: 'Reduce Motion',
      description: 'Minimize animations and transitions across the app',
      icon: Sparkles,
      value: reduceMotionOverride,
      onToggle: setReduceMotionOverride,
    },
    {
      key: 'reduceHaptics',
      label: 'Reduce Haptics',
      description: 'Turn off vibration feedback on taps and confirmations',
      icon: Vibrate,
      value: reduceHaptics,
      onToggle: setReduceHaptics,
    },
  ];

  const handleToggle = (row: ToggleRow) => {
    // Selection tick fires only when turning a setting ON — quieting haptics
    // shouldn't itself buzz, and the guard in `haptics` already suppresses it
    // once reduceHaptics flips true.
    if (!row.value) haptics.selection();
    row.onToggle(!row.value);
  };

  return (
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
      <Eyebrow className="mb-2">Motion & feedback</Eyebrow>
      <Card padding="none" className="overflow-hidden">
        {rows.map((row, idx) => {
          const RowIcon = row.icon;
          const isLast = idx === rows.length - 1;
          return (
            <Pressable
              key={row.key}
              onPress={() => handleToggle(row)}
              className={`flex-row items-center justify-between p-4 ${
                isLast ? '' : 'border-b border-divider'
              }`}
              android_ripple={{ color: `${LightColors.primary}14` }}
              accessibilityRole="switch"
              accessibilityLabel={row.label}
              accessibilityHint={row.description}
              accessibilityState={{ checked: row.value }}
              style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
            >
              <View className="flex-row items-center gap-3 flex-1 mr-3">
                <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center">
                  <RowIcon size={18} color={LightColors.primary} strokeWidth={1.8} />
                </View>
                <View className="flex-1">
                  <Text className="text-[14px] font-montserrat-semi text-textPrimary">
                    {row.label}
                  </Text>
                  <Text className="text-sm font-montserrat text-textSecondary mt-0.5">
                    {row.description}
                  </Text>
                </View>
              </View>
              {/* Switch is a visual indicator only — the whole row owns the
                  touch + a11y (role=switch), matching the notifications screen. */}
              <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
                <Switch
                  value={row.value}
                  trackColor={{ false: LightColors.dividerStrong, true: LightColors.primaryMuted }}
                  thumbColor={row.value ? LightColors.primary : LightColors.surface}
                />
              </View>
            </Pressable>
          );
        })}
      </Card>

      <Text className="text-xs font-montserrat text-textSecondary mt-4 px-1 leading-4">
        These settings are saved on this device. Reduce Motion also respects your
        phone&apos;s system accessibility setting. To change text size, use your
        phone&apos;s system display settings.
      </Text>
    </ScrollView>
  );
}
