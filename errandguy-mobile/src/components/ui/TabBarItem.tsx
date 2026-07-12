import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';

/** Base Ionicons names used by the tab bars. The `-outline` variant is
 *  rendered when inactive; the solid (base) glyph when active. */
export type TabIconName =
  | 'home'
  | 'list'
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
}

const ACTIVE = LightColors.primary;
// textTertiary (#64748B ~5.2:1 on white) clears the 3:1 non-text glyph
// floor that textMuted (#94A3B8 ~2.57:1) failed — inactive icons must
// stay legible in outdoor sunlight while still reading subordinate to
// the brand-blue active glyph.
const INACTIVE = LightColors.textTertiary;

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
}: TabBarItemProps) {
  const { mScale } = useResponsive();
  const color = focused ? ACTIVE : INACTIVE;
  const iconName = (focused ? name : `${name}-outline`) as React.ComponentProps<
    typeof Ionicons
  >['name'];

  const slot = mScale(48);
  const iconSize = mScale(22);
  const badgeSize = mScale(16);
  // The online dot carries the runner's single most earnings-critical
  // state, so it scales with the glyph (unlike a fixed disc that shrinks
  // to a sub-perceptible speck on a tablet) and stays big enough to catch
  // a moving sunlight glance.
  const dotSize = mScale(11);
  // Font + line height scale together so digits never clip on tablets.
  const badgeFontSize = Math.max(9, badgeSize * 0.56);

  return (
    <View style={[s.wrap, { width: slot }]}>
      <View style={s.iconBox} pointerEvents="none">
        <Ionicons name={iconName} size={iconSize} color={color} />
        {!!badgeCount && badgeCount > 0 && (
          <View
            style={[
              s.badge,
              { minWidth: badgeSize, height: badgeSize, borderRadius: badgeSize / 2 },
            ]}
          >
            <Text
              style={[
                s.badgeText,
                {
                  fontSize: badgeFontSize,
                  lineHeight: Math.round(badgeFontSize * 1.2),
                },
              ]}
              allowFontScaling={false}
            >
              {badgeCount > 9 ? '9+' : String(badgeCount)}
            </Text>
          </View>
        )}
        {showOnlineDot && (
          <View
            style={[
              s.onlineDot,
              { width: dotSize, height: dotSize, borderRadius: dotSize / 2 },
            ]}
          />
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    // Fill the icon slot's full height so the glyph sits dead-centre.
    // Without this the icon hugs the top and leaves a gap at the bottom
    // (react-navigation still reserves label space even with the label
    // hidden). Paired with `tabBarIconStyle: { flex: 1 }` in the layouts.
    flex: 1,
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
  },
  onlineDot: {
    // Size (width/height/borderRadius) is applied inline so it can mScale
    // with the glyph; the surface-colored ring keeps it legible against
    // the dark home icon. Screen-reader semantics live on the layout's
    // tabBarAccessibilityLabel (this view is pointerEvents-none).
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: LightColors.success,
    borderWidth: 1.5,
    borderColor: LightColors.surface,
  },
});
