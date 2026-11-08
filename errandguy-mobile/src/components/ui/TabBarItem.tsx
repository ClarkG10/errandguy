import React from 'react';
import { View, Text, StyleSheet, Platform, type TextStyle } from 'react-native';
import { Bell, History, House, List, User, Wallet, type LucideIcon } from 'lucide-react-native';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';
import { CHROME_MAX_FONT_SCALE } from '../../constants/fontScale';

/** The tab bars' icons, by role. Drawn with Lucide, the icon set every other
 *  screen uses: the bars were the one place on Ionicons, so their glyphs
 *  (filled/outline, a different stroke and corner style) didn't match the
 *  icons on the screens above them. */
export type TabIconName =
  | 'home'
  | 'list'
  | 'notifications'
  | 'person'
  | 'wallet'
  | 'time';

const ICONS: Record<TabIconName, LucideIcon> = {
  home: House,
  list: List,
  notifications: Bell,
  person: User,
  wallet: Wallet,
  time: History,
};

interface TabBarItemProps {
  name: TabIconName;
  focused: boolean;
  badgeCount?: number;
  showOnlineDot?: boolean;
}

const ACTIVE = LightColors.primary;
// textTertiary (#617088 ~5.0:1 on white) clears the 3:1 non-text glyph
// floor that textMuted (#94A3B8 ~2.57:1) failed — inactive icons must
// stay legible in outdoor sunlight while still reading subordinate to
// the brand-blue active glyph.
const INACTIVE = LightColors.textTertiary;

/**
 * The icon of a tab-bar entry; the navigator draws the text label under it.
 *
 * Active state is shown by the icon: brand blue with a heavier stroke when
 * focused, slate with the standard stroke when not (Lucide has no filled
 * variants). The label under it changes colour too. No active dot.
 * The notification badge and runner online dot stay because they carry
 * information, not selection state.
 */
export function TabBarItem({
  name,
  focused,
  badgeCount,
  showOnlineDot,
}: TabBarItemProps) {
  const { mScale } = useResponsive();
  const color = focused ? ACTIVE : INACTIVE;
  const Icon = ICONS[name];

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
        <Icon size={iconSize} color={color} strokeWidth={focused ? 2.4 : 1.9} />
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

/** The word under each tab icon — shared by both tab bars. */
export const TAB_LABEL_STYLE: TextStyle = { fontFamily: 'Quicksand_600SemiBold', fontSize: 11 };

/**
 * The tab label, capped at the chrome font scale. The bar is a fixed-height
 * strip, and on Android the navigator's own label grew without limit, so at
 * large text sizes the word squeezed the icon out of its slot. iOS keeps the
 * navigator's label: it doesn't scale there at all (the system's Large
 * Content Viewer shows it instead), and VoiceOver's "Home, tab, 1 of 4" is
 * only built for a plain-string label. Pass as `tabBarLabel`.
 */
export const cappedTabBarLabel =
  Platform.OS === 'android'
    ? ({ color, children }: { color: string; children: string }) => (
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
          style={[s.tabLabel, TAB_LABEL_STYLE, { color }]}
        >
          {children}
        </Text>
      )
    : undefined;

const s = StyleSheet.create({
  tabLabel: {
    textAlign: 'center',
    backgroundColor: 'transparent',
  },
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
