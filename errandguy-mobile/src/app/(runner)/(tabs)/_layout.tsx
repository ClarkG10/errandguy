import { Tabs } from 'expo-router';
import { Home, DollarSign, Clock, User } from 'lucide-react-native';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRunnerStore } from '../../../stores/runnerStore';
import { TabBarItem } from '../../../components/ui/TabBarItem';

const ACTIVE = '#2563EB';
const INACTIVE = '#94A3B8';
const BAR_HEIGHT = 56;

export default function RunnerTabsLayout() {
  const isOnline = useRunnerStore((s) => s.isOnline);
  const insets = useSafeAreaInsets();
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
