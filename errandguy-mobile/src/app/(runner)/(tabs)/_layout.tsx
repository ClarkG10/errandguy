import { Tabs } from 'expo-router';
import { Home, DollarSign, Clock, User } from 'lucide-react-native';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRunnerStore } from '../../../stores/runnerStore';
import { TabBarItem } from '../../../components/ui/TabBarItem';
import {
  TAB_BAR_HEIGHT as BAR_HEIGHT,
  TAB_BAR_FLOAT_GAP,
  TAB_BAR_SIDE_MARGIN,
} from '../../../constants/tabLayout';
import { LightColors } from '../../../constants/colors';

const ACTIVE = LightColors.primary;
const INACTIVE = LightColors.textMuted;

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
        // Floating pill nav — see customer tab layout for rationale.
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
