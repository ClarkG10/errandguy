import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';

/** Base Ionicons names used by the tab bars. The `-outline` variant is
 *  rendered when inactive; the solid (base) glyph when active. */
export type TabIconName =
  | 'home'
  | 'receipt'
  | 'notifications'
  | 'person'
  | 'wallet'
  | 'time';

interface TabBarItemProps {
  /** Base Ionicons name (without the `-outline` suffix). */
  name: TabIconName;
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
 * A single tab-bar entry — icon only.
 *
 * Active state is conveyed entirely by the icon: a solid (filled) glyph in
 * brand blue when focused, the outline variant in muted slate when not.
 * No label and no active dot — the outline→solid swap is the whole
 * affordance. The notification badge and runner online dot stay because
 * they carry information, not selection state.
 */
export function TabBarItem({
  name,
  focused,
  badgeCount,
  showOnlineDot,
  offsetX = 0,
}: TabBarItemProps) {
  const { mScale } = useResponsive();
  const color = focused ? ACTIVE : INACTIVE;
  const iconName = (focused ? name : `${name}-outline`) as React.ComponentProps<
    typeof Ionicons
  >['name'];

  const slot = mScale(56);
  const iconSize = mScale(26);
  const badgeSize = mScale(16);

  return (
    <View style={[s.wrap, { width: slot, transform: [{ translateX: offsetX }] }]}>
      <View style={s.iconBox}>
        <Ionicons name={iconName} size={iconSize} color={color} />
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
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBox: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -9,
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
    top: -2,
    right: -2,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: LightColors.success,
    borderWidth: 1.5,
    borderColor: LightColors.surface,
  },
});
