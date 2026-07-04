import { Tabs } from 'expo-router';
import { Home, ClipboardList, Bell, User } from 'lucide-react-native';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotificationStore } from '../../../stores/notificationStore';
import { TabBarItem } from '../../../components/ui/TabBarItem';
import { QuickBookFAB } from '../../../components/ui/QuickBookFAB';
import {
  TAB_BAR_HEIGHT as BAR_HEIGHT,
  TAB_BAR_FLOAT_GAP,
  TAB_BAR_SIDE_MARGIN,
} from '../../../constants/tabLayout';
import { LightColors } from '../../../constants/colors';

const ACTIVE = LightColors.primary;
const INACTIVE = LightColors.textMuted;

export default function CustomerTabsLayout() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const insets = useSafeAreaInsets();

  // Edge-to-edge bottom inset — the OS knows what its own nav needs.
  const bottomInset = insets.bottom;

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
        // Floating pill nav — the bar detaches from the screen bottom
        // and hovers as a rounded capsule (2026 pattern). Content
        // scrolls behind it; the safe-area inset lifts it clear of
        // the Android nav bar / iOS home indicator, with a minimum
        // float gap on inset-less devices.
        tabBarStyle: {
          position: 'absolute',
          left: TAB_BAR_SIDE_MARGIN,
          right: TAB_BAR_SIDE_MARGIN,
          bottom: Math.max(bottomInset, TAB_BAR_FLOAT_GAP) + TAB_BAR_FLOAT_GAP / 2,
          backgroundColor: LightColors.surface,
          borderTopWidth: 0,
          borderRadius: 999,
          height: BAR_HEIGHT,
          paddingTop: 6,
          paddingBottom: 6,
          paddingHorizontal: 14,
          // Soft diffuse lift so the pill reads as a floating surface.
          ...Platform.select({
            ios: {
              shadowColor: LightColors.textPrimary,
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.1,
              shadowRadius: 24,
            },
            android: { elevation: 12 },
          }),
        },
        tabBarItemStyle: {
          height: BAR_HEIGHT - 12,
          paddingTop: 0,
          paddingBottom: 0,
          paddingHorizontal: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => (
            <TabBarItem Icon={Home} label="Home" focused={focused} offsetX={-6} />
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ focused }) => (
            <TabBarItem Icon={ClipboardList} label="Activity" focused={focused} offsetX={-22} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Alerts',
          tabBarIcon: ({ focused }) => (
            <TabBarItem
              Icon={Bell}
              label="Alerts"
              focused={focused}
              offsetX={22}
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
            <TabBarItem Icon={User} label="Profile" focused={focused} offsetX={6} />
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
