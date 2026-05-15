import { Tabs } from 'expo-router';
import { Home, ClipboardList, Bell, User } from 'lucide-react-native';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotificationStore } from '../../../stores/notificationStore';
import { TabBarItem } from '../../../components/ui/TabBarItem';
import { QuickBookFAB } from '../../../components/ui/QuickBookFAB';
import { TAB_BAR_HEIGHT as BAR_HEIGHT } from '../../../constants/tabLayout';

const ACTIVE = '#2563EB';
const INACTIVE = '#94A3B8';

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
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: '#E6EBF2',
          height: BAR_HEIGHT + bottomInset,
          paddingTop: 8,
          paddingBottom: bottomInset + 1,
          paddingHorizontal: 10,
          // Lighter, brand-tinted lift — keeps the bar feeling like a
          // floating surface rather than a heavy slab.
          ...Platform.select({
            ios: {
              shadowColor: '#1D4ED8',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.06,
              shadowRadius: 14,
            },
            android: { elevation: 10 },
          }),
        },
        tabBarItemStyle: {
          height: BAR_HEIGHT,
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
