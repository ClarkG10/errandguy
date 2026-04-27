import { Tabs } from 'expo-router';
import { Home, DollarSign, Clock, User } from 'lucide-react-native';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRunnerStore } from '../../../stores/runnerStore';

const ACTIVE = '#2563EB';
const INACTIVE = '#94A3B8';
const BAR_HEIGHT = 56;

function TabItem({
  Icon,
  label,
  color,
  focused,
  showOnlineDot,
}: {
  Icon: typeof Home;
  label: string;
  color: string;
  focused: boolean;
  showOnlineDot?: boolean;
}) {
  return (
    <View style={styles.itemWrap}>
      <View style={[styles.iconPill, focused && { backgroundColor: '#EFF4FF' }]}>
        <Icon size={20} color={color} strokeWidth={focused ? 2.4 : 1.9} />
        {showOnlineDot && <View style={styles.onlineDot} />}
      </View>
      <Text
        numberOfLines={1}
        style={[styles.label, { color }, focused && styles.labelFocused]}
      >
        {label}
      </Text>
    </View>
  );
}

export default function RunnerTabsLayout() {
  const isOnline = useRunnerStore((s) => s.isOnline);
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: 'shift',
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: '#E2E8F0',
          height: BAR_HEIGHT + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom,
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
        tabBarItemStyle: { height: BAR_HEIGHT },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <TabItem
              Icon={Home}
              label="Home"
              color={color}
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
          tabBarIcon: ({ color, focused }) => (
            <TabItem
              Icon={DollarSign}
              label="Earnings"
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, focused }) => (
            <TabItem Icon={Clock} label="History" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <TabItem Icon={User} label="Profile" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  itemWrap: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPill: {
    width: 48,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  label: {
    fontFamily: 'Quicksand_500Medium',
    fontSize: 11,
    marginTop: 2,
    lineHeight: 13,
  },
  labelFocused: {
    fontFamily: 'Quicksand_700Bold',
  },
  onlineDot: {
    position: 'absolute',
    top: 2,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
});

