import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { TabBarItem } from '../../../components/ui/TabBarItem';
import { HidingTabBar } from '../../../components/ui/HidingTabBar';
import {
  TAB_BAR_HEIGHT as BAR_HEIGHT,
} from '../../../constants/tabLayout';
import { LightColors } from '../../../constants/colors';

const ACTIVE = LightColors.primary;
// textTertiary clears the 3:1 non-text glyph floor that textMuted failed
// (shared with the customer bar via TabBarItem). Labels are hidden, so this
// only feeds react-navigation's inactive tint, but keep it in sync.
const INACTIVE = LightColors.textTertiary;

export default function RunnerTabsLayout() {
  const isOnline = useRunnerStore((s) => s.isOnline);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  // React Navigation renders a supplied numeric tabBarStyle.height
  // verbatim — it does NOT add the bottom inset — so a flat height would
  // sit the bar flush and collide the icon row with the home indicator /
  // gesture bar on inset devices. Grow the bar and reserve the inset as
  // bottom padding; the item grows with it so the glyph stays centred in
  // the visible strip above the inset.
  const barHeight = BAR_HEIGHT + insets.bottom;

  return (
    <Tabs
      // Auto-hiding bar: slides away on scroll-down, returns on scroll-up.
      // Absolute-positioned (see HidingTabBar) so the scene fills behind it.
      tabBar={(props) => <HidingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        // 'shift' animates the whole screen on every tab switch; snap
        // instantly when the runner has asked for reduced motion.
        animation: reduceMotion ? 'none' : 'shift',
        // See customer tab layout for rationale — freezes off-screen
        // tabs (so the History list stops re-rendering while the
        // runner is on Home receiving GPS pings) and lazy-mounts
        // each tab the first time it's focused.
        freezeOnBlur: true,
        lazy: true,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarShowLabel: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: LightColors.surface,
          borderTopWidth: 1,
          borderTopColor: LightColors.divider,
          height: barHeight,
          paddingTop: 4,
          paddingBottom: Math.max(insets.bottom, 4),
          paddingHorizontal: 8,
          ...Platform.select({
            ios: {
              shadowColor: '#0F172A',
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.04,
              shadowRadius: 8,
            },
            android: { elevation: 4 },
          }),
        },
        tabBarItemStyle: {
          // Match the customer bar: size the touch slot to the visible strip
          // (bar minus a little) + inset so the glyph centres in the strip
          // above the home indicator instead of floating mid-bar, which read
          // as an over-tall bar.
          height: BAR_HEIGHT - 12 + insets.bottom,
          paddingTop: 0,
          paddingBottom: 0,
        },
        // Fill the icon container so the icon-only glyph centres vertically
        // instead of leaving a gap at the bottom (reserved label space).
        tabBarIconStyle: { flex: 1 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          // Online/offline is the runner's most earnings-critical state
          // but the visual dot lives in a pointerEvents-none view
          // VoiceOver skips — surface it on the tab itself.
          tabBarAccessibilityLabel: isOnline
            ? 'Home, you are online'
            : 'Home, you are offline',
          tabBarIcon: ({ focused }) => (
            <TabBarItem name="home" focused={focused} showOnlineDot={isOnline} />
          ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          tabBarIcon: ({ focused }) => (
            <TabBarItem name="wallet" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ focused }) => (
            <TabBarItem name="time" focused={focused} />
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
  );
}
