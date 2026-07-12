import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotificationStore } from '../../../stores/notificationStore';
import { TabBarItem } from '../../../components/ui/TabBarItem';
import { QuickBookFAB } from '../../../components/ui/QuickBookFAB';
import {
  TAB_BAR_HEIGHT as BAR_HEIGHT,
  TAB_BAR_CENTER_GAP,
} from '../../../constants/tabLayout';
import { LightColors } from '../../../constants/colors';

const ACTIVE = LightColors.primary;
// textTertiary clears the 3:1 non-text glyph floor that textMuted failed
// (shared with the runner bar via TabBarItem). Labels are hidden, so this
// only feeds react-navigation's inactive tint, but keep it in sync.
const INACTIVE = LightColors.textTertiary;

// Screen-level tabBarItemStyle replaces (not merges with) the
// navigator-level one, so the middle tabs spread this base and add
// their half of the centre gap on top.
const ITEM_STYLE = {
  height: BAR_HEIGHT - 12,
  paddingTop: 0,
  paddingBottom: 0,
  paddingHorizontal: 2,
} as const;

export default function CustomerTabsLayout() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const insets = useSafeAreaInsets();

  // React Navigation renders a supplied numeric tabBarStyle.height
  // verbatim — it does NOT add the bottom inset — so a flat height would
  // sit the bar flush and collide the icon row with the home indicator /
  // gesture bar on inset devices. Grow the bar and reserve the inset as
  // bottom padding; the item grows with it so the glyph stays centred in
  // the visible strip above the inset.
  const itemStyle = {
    ...ITEM_STYLE,
    height: ITEM_STYLE.height + insets.bottom,
  };

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: 'shift',
        // Suspend off-screen tab subtrees: their components stay
        // mounted (so navigating back is instant and scroll position
        // is preserved) but React skips re-rendering them and any
        // animations / setState in their effects pause. This is the
        // single biggest win for low-end Android — a backgrounded
        // Activity tab no longer re-renders the booking list every
        // time the foreground Home tab pings the API.
        freezeOnBlur: true,
        // Defer mounting each tab until first focus. Tabs the user
        // never visits in a session never pay their mount cost.
        lazy: true,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarShowLabel: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: LightColors.surface,
          borderTopWidth: 1,
          borderTopColor: LightColors.divider,
          height: BAR_HEIGHT + insets.bottom,
          paddingTop: 4,
          paddingBottom: Math.max(insets.bottom, 4),
          paddingHorizontal: 8,
        },
        tabBarItemStyle: itemStyle,
        // Let the icon container fill the item height so the icon-only
        // glyph centres vertically instead of leaving a gap at the bottom
        // (the space react-navigation reserves for a now-hidden label).
        tabBarIconStyle: { flex: 1 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => (
            <TabBarItem name="home" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          // Half the centre gap on each middle item leaves real layout
          // space for the QuickBookFAB — glyph and touch slot move
          // together (a translateX nudge would move only the glyph).
          tabBarItemStyle: {
            ...itemStyle,
            marginRight: TAB_BAR_CENTER_GAP / 2,
          },
          tabBarIcon: ({ focused }) => (
            <TabBarItem name="list" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Alerts',
          // Surface the badge count to screen readers — the visual
          // badge lives in a pointerEvents-none view VoiceOver skips.
          tabBarAccessibilityLabel:
            unreadCount > 0
              ? `Alerts, ${unreadCount > 9 ? 'more than 9' : unreadCount} unread`
              : 'Alerts',
          tabBarItemStyle: {
            ...itemStyle,
            marginLeft: TAB_BAR_CENTER_GAP / 2,
          },
          tabBarIcon: ({ focused }) => (
            <TabBarItem
              name="notifications"
              focused={focused}
              badgeCount={unreadCount}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => (
            <TabBarItem name="person" focused={focused} />
          ),
        }}
      />
    </Tabs>
    {/* Overlaid quick-book FAB — sits above the tab bar centre and
        opens the errand-type fan-out menu. Rendered as a sibling of
        <Tabs> so it can float on top of every tab route without each
        screen needing to know about it. */}
    <QuickBookFAB tabBarHeight={BAR_HEIGHT} />
    </View>
  );
}
