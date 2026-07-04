import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';

interface TabBarItemProps {
  Icon: LucideIcon;
  label: string;
  focused: boolean;
  badgeCount?: number;
  showOnlineDot?: boolean;
  /** Horizontal nudge in pt. Used by the customer tabs to slide
   *  outermost items toward the screen edges so the centre stays
   *  visually empty for the floating QuickBookFAB. */
  offsetX?: number;
}

const ACTIVE = LightColors.primary;
const INACTIVE = LightColors.textMuted;

/**
 * A single tab-bar entry — clean iOS-style.
 *
 * Active state is conveyed by:
 *   • icon colour shift (slate → brand blue)
 *   • slightly heavier icon stroke
 *   • bold label
 *   • a tiny 4pt brand dot directly under the label
 *
 * No coloured pill behind the icon — the previous soft-blue chip
 * read as visual noise on a list-heavy app where the user looks at
 * the bar dozens of times an hour. The dot is enough.
 */
export function TabBarItem({
  Icon,
  label,
  focused,
  badgeCount,
  showOnlineDot,
  offsetX = 0,
}: TabBarItemProps) {
  const { mScale } = useResponsive();
  const color = focused ? ACTIVE : INACTIVE;

  // Sizes scale moderately with screen width.
  const slot = mScale(64);
  const iconBox = mScale(28);
  const iconSize = mScale(22);
  const labelSize = mScale(10.5);
  const badgeSize = mScale(16);
  const dotSize = mScale(4);

  return (
    <View style={[s.wrap, { width: slot, transform: [{ translateX: offsetX }] }]}>
      <View style={[s.iconBox, { width: iconBox, height: iconBox }]}>
        <Icon size={iconSize} color={color} strokeWidth={focused ? 2.4 : 1.8} />
        {!!badgeCount && badgeCount > 0 && (
          <View
            style={[
              s.badge,
              { minWidth: badgeSize, height: badgeSize, borderRadius: badgeSize / 2 },
            ]}
          >
            <Text
              style={[s.badgeText, { fontSize: Math.max(9, badgeSize * 0.56) }]}
              allowFontScaling={false}
            >
              {badgeCount > 9 ? '9+' : String(badgeCount)}
            </Text>
          </View>
        )}
        {showOnlineDot && <View style={s.onlineDot} />}
      </View>
      <Text
        allowFontScaling={false}
        style={[
          s.label,
          { color, fontSize: labelSize, fontWeight: focused ? '700' : '500' },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {/* Active indicator — a tiny brand dot. Reserved space when
          inactive so the label position never shifts on tab change. */}
      <View
        style={[
          s.activeDot,
          {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: focused ? ACTIVE : 'transparent',
          },
        ]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 4,
  },
  iconBox: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  label: {
    marginTop: 2,
    letterSpacing: 0.1,
    fontFamily: 'Quicksand_500Medium',
  },
  activeDot: {
    marginTop: 3,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    paddingHorizontal: 4,
    backgroundColor: LightColors.danger,
    borderWidth: 1.5,
    borderColor: LightColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: LightColors.textInverse,
    fontFamily: 'Quicksand_700Bold',
    lineHeight: 11,
  },
  onlineDot: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: LightColors.success,
    borderWidth: 1.5,
    borderColor: LightColors.surface,
  },
});

