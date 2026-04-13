import { Tabs } from 'expo-router';
import { Home, DollarSign, Clock, User } from 'lucide-react-native';
import { View, Platform, StyleSheet } from 'react-native';
import { useRunnerStore } from '../../../stores/runnerStore';

export default function RunnerTabsLayout() {
  const isOnline = useRunnerStore((s) => s.isOnline);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#2563EB',
        tabBarInactiveTintColor: '#94A3B8',
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontFamily: 'Poppins_600SemiBold',
          fontSize: 11,
          marginTop: 2,
        },
        tabBarStyle: {
          position: 'absolute',
          bottom: Platform.OS === 'ios' ? 24 : 16,
          left: 16,
          right: 16,
          backgroundColor: '#FFFFFF',
          borderRadius: 24,
          height: 68,
          borderTopWidth: 0,
          paddingBottom: 0,
          ...Platform.select({
            ios: {
              shadowColor: '#0F172A',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.12,
              shadowRadius: 24,
            },
            android: { elevation: 12 },
          }),
        },
        tabBarItemStyle: {
          paddingTop: 10,
          paddingBottom: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <View style={rs.iconWrap}>
              <Home size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
              {focused && <View style={rs.activeIndicator} />}
              {isOnline && (
                <View style={rs.onlineDot} />
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          tabBarIcon: ({ color, focused }) => (
            <View style={rs.iconWrap}>
              <DollarSign size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
              {focused && <View style={rs.activeIndicator} />}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, focused }) => (
            <View style={rs.iconWrap}>
              <Clock size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
              {focused && <View style={rs.activeIndicator} />}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <View style={rs.iconWrap}>
              <User size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
              {focused && <View style={rs.activeIndicator} />}
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const rs = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  activeIndicator: {
    position: 'absolute',
    bottom: -8,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2563EB',
  },
  onlineDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
});
