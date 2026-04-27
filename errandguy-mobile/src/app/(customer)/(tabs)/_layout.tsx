import { Tabs } from 'expo-router';
import { Home, ClipboardList, Bell, User } from 'lucide-react-native';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotificationStore } from '../../../stores/notificationStore';

const ACTIVE = '#2563EB';
const INACTIVE = '#94A3B8';
const BAR_HEIGHT = 56;

/** Modern attached tab bar item with optional badge.
 *  Replaces the previous floating/rounded bar — now a clean,
 *  edge-to-edge bar with a thin top divider and a soft pill
 *  highlight on the active item (no jarring movement). */
function TabItem({
  Icon,
  label,
  color,
  focused,
  badgeCount,
  showOnlineDot,
}: {
  Icon: typeof Home;
  label: string;
  color: string;
  focused: boolean;
  badgeCount?: number;
  showOnlineDot?: boolean;
}) {
  return (
    <View style={styles.itemWrap}>
      <View
        style={[
          styles.iconPill,
          focused && { backgroundColor: '#EFF4FF' },
        ]}
      >
        <Icon size={20} color={color} strokeWidth={focused ? 2.4 : 1.9} />
        {!!badgeCount && badgeCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {badgeCount > 9 ? '9+' : String(badgeCount)}
            </Text>
          </View>
        )}
        {showOnlineDot && <View style={styles.onlineDot} />}
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          { color },
          focused && styles.labelFocused,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export default function CustomerTabsLayout() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
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
          // Subtle elevation only — no detached/floating shadow.
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
            <TabItem Icon={Home} label="Home" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color, focused }) => (
            <TabItem
              Icon={ClipboardList}
              label="Activity"
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Alerts',
          tabBarIcon: ({ color, focused }) => (
            <TabItem
              Icon={Bell}
              label="Alerts"
              color={color}
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
  badge: {
    position: 'absolute',
    top: -2,
    right: 6,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: 'Quicksand_700Bold',
    lineHeight: 11,
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

