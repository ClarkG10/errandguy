import { Tabs } from 'expo-router';
import { Home, ClipboardList, Bell, User } from 'lucide-react-native';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotificationStore } from '../../../stores/notificationStore';
import { TabBarItem } from '../../../components/ui/TabBarItem';

const ACTIVE = '#2563EB';
const INACTIVE = '#94A3B8';

// One bar height for both platforms — the previous setup let Android
// inflate the items because it relied on default Material padding.
// 56 keeps us close to the iOS 49pt + label spec while still meeting
// Android's 48dp touch-target minimum.
const BAR_HEIGHT = 56;

export default function CustomerTabsLayout() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const insets = useSafeAreaInsets();

  // Mirror native behaviour (Facebook, Instagram, etc.): on Android
  // edge-to-edge mode the tab bar's bottom padding equals the gesture
  // / 3-button nav inset so the bar sits flush against the system nav
  // and labels never get clipped. iOS gets the home-indicator inset.
  // No artificial caps — the OS knows what its own nav needs.
  const bottomInset = insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: 'shift',
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarShowLabel: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: '#E2E8F0',
          height: BAR_HEIGHT + bottomInset,
          paddingTop: 4,
          paddingBottom: bottomInset,
          ...Platform.select({
            ios: {
              shadowColor: '#0F172A',
              shadowOffset: { width: 0, height: -1 },
              shadowOpacity: 0.04,
              shadowRadius: 4,
            },
            android: { elevation: 4 },
          }),
        },
        tabBarItemStyle: {
          height: BAR_HEIGHT,
          paddingTop: 0,
          paddingBottom: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => (
            <TabBarItem Icon={Home} label="Home" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ focused }) => (
            <TabBarItem Icon={ClipboardList} label="Activity" focused={focused} />
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
            <TabBarItem Icon={User} label="Profile" focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
