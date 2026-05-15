import { Tabs } from 'expo-router';
import { Home, DollarSign, Clock, User } from 'lucide-react-native';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRunnerStore } from '../../../stores/runnerStore';
import { TabBarItem } from '../../../components/ui/TabBarItem';
import { TAB_BAR_HEIGHT as BAR_HEIGHT } from '../../../constants/tabLayout';

const ACTIVE = '#2563EB';
const INACTIVE = '#94A3B8';

export default function RunnerTabsLayout() {
  const isOnline = useRunnerStore((s) => s.isOnline);
  const insets = useSafeAreaInsets();
  const bottomInset = insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: 'shift',
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
          backgroundColor: '#FFFFFF',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: '#E6EBF2',
          height: BAR_HEIGHT + bottomInset,
          paddingTop: 8,
          paddingBottom: bottomInset + 1,
          paddingHorizontal: 10,
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
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => (
            <TabBarItem
              Icon={Home}
              label="Home"
              focused={focused}
              showOnlineDot={isOnline}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          tabBarIcon: ({ focused }) => (
            <TabBarItem Icon={DollarSign} label="Earnings" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ focused }) => (
            <TabBarItem Icon={Clock} label="History" focused={focused} />
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
