import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ChevronRight,
  User,
  FileText,
  Car,
  Wallet,
  ClipboardList,
  MapPin,
  Bell,
  Moon,
  HelpCircle,
  ScrollText,
  LogOut,
  Trash2,
} from 'lucide-react-native';
import { Avatar } from '../../../components/ui/Avatar';
import { Badge } from '../../../components/ui/Badge';
import { Card } from '../../../components/ui/Card';
import { PerformanceMetric } from '../../../components/runner/PerformanceMetric';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useAuthStore } from '../../../stores/authStore';
import { runnerService } from '../../../services/runner.service';
import type { LucideIcon } from 'lucide-react-native';

interface MenuItem {
  icon: LucideIcon;
  label: string;
  route?: string;
  color?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
}

export default function RunnerProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { runnerProfile, setRunnerProfile } = useRunnerStore();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await runnerService.getRunnerProfile();
      setRunnerProfile(res.data.data);
    } catch {}
    setRefreshing(false);
  }, []);

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: () => {
          logout();
          router.replace('/(auth)/welcome' as any);
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Your account will be deactivated and permanently deleted after 30 days. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // Would call delete API
          },
        },
      ],
    );
  };

  const isVerified = runnerProfile?.verification_status === 'approved';

  const accountMenu: MenuItem[] = [
    { icon: User, label: 'Edit Profile', route: '/(runner)/settings/edit-profile' },
    { icon: FileText, label: 'Documents & Verification', route: '/(runner)/settings/documents' },
    { icon: Car, label: 'Vehicle Information', route: '/(runner)/settings/vehicle' },
    { icon: Wallet, label: 'Payout Settings', route: '/(runner)/payout' },
    { icon: ClipboardList, label: 'Preferred Errand Types', route: '/(runner)/settings/preferred-types' },
    { icon: MapPin, label: 'Working Areas', route: '/(runner)/settings/working-areas' },
  ];

  const settingsMenu: MenuItem[] = [
    { icon: Bell, label: 'Notification Preferences', route: '/(runner)/settings/notifications' },
    { icon: HelpCircle, label: 'Help & Support', route: '/(runner)/settings/help' },
    { icon: ScrollText, label: 'Terms & Privacy', route: '/(runner)/settings/terms' },
  ];

  const renderMenuItem = (item: MenuItem, idx: number, arr: MenuItem[]) => (
    <Pressable
      key={item.label}
      onPress={() => {
        if (item.onPress) item.onPress();
        else if (item.route) router.push(item.route as any);
      }}
      className="flex-row items-center justify-between py-3.5"
    >
      <View className="flex-row items-center gap-3">
        <item.icon size={20} color={item.color ?? '#475569'} />
        <Text
          className="text-sm font-montserrat text-textPrimary"
          style={item.color ? { color: item.color } : undefined}
        >
          {item.label}
        </Text>
      </View>
      {item.trailing ?? <ChevronRight size={18} color="#94A3B8" />}
    </Pressable>
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="px-5 py-4">
        <Text className="text-lg font-montserrat-bold text-textPrimary">Profile</Text>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* Profile Header */}
        <View className="items-center px-5 mb-6">
          <Avatar uri={user?.avatar_url} name={user?.full_name} size="xl" />
          <Text className="text-xl font-montserrat-bold text-textPrimary mt-3">
            {user?.full_name ?? 'Runner'}
          </Text>
          <Text className="text-sm font-montserrat text-textSecondary mt-0.5">
            ★ {user?.avg_rating?.toFixed(1) ?? '0.0'} • {runnerProfile?.total_errands ?? 0} errands
          </Text>
          {isVerified && (
            <View className="mt-2">
              <Badge label="✅ Verified Runner" variant="primary" />
            </View>
          )}
        </View>

        {/* Performance */}
        <View className="px-5 mb-4">
          <Text className="text-sm font-montserrat-bold text-textSecondary mb-3">Performance</Text>
          <Card className="p-4">
            <View className="flex-row gap-3 mb-3">
              <PerformanceMetric
                value={runnerProfile?.acceptance_rate ?? 0}
                label="Acceptance"
                color={
                  (runnerProfile?.acceptance_rate ?? 0) < 70 ? '#F97316' : '#22C55E'
                }
              />
              <PerformanceMetric
                value={runnerProfile?.completion_rate ?? 0}
                label="Completion"
                color={
                  (runnerProfile?.completion_rate ?? 0) < 80 ? '#F97316' : '#22C55E'
                }
              />
              <PerformanceMetric
                value={parseFloat(user?.avg_rating?.toFixed(1) ?? '0')}
                label="Rating"
                color="#F59E0B"
                suffix="★"
              />
            </View>
            <View className="flex-row items-center justify-between pt-2 border-t border-divider">
              <Text className="text-xs font-montserrat text-textSecondary">Member since</Text>
              <Text className="text-xs font-montserrat-bold text-textPrimary">
                {runnerProfile
                  ? new Date(runnerProfile.created_at).toLocaleDateString([], {
                      month: 'short',
                      year: 'numeric',
                    })
                  : '--'}
              </Text>
            </View>
          </Card>
        </View>

        {/* Account Menu */}
        <View className="px-5 mb-4">
          <Text className="text-sm font-montserrat-bold text-textSecondary mb-1">Account</Text>
          <Card className="px-4">
            {accountMenu.map((item, idx, arr) => (
              <View key={item.label}>
                {renderMenuItem(item, idx, arr)}
                {idx < arr.length - 1 && <View className="border-b border-divider" />}
              </View>
            ))}
          </Card>
        </View>

        {/* Settings Menu */}
        <View className="px-5 mb-6">
          <Text className="text-sm font-montserrat-bold text-textSecondary mb-1">Settings</Text>
          <Card className="px-4">
            {settingsMenu.map((item, idx, arr) => (
              <View key={item.label}>
                {renderMenuItem(item, idx, arr)}
                {idx < arr.length - 1 && <View className="border-b border-divider" />}
              </View>
            ))}
          </Card>
        </View>

        {/* Logout + Delete */}
        <View className="px-5 gap-3 mb-6">
          <Pressable
            onPress={handleLogout}
            className="bg-surface border border-divider rounded-xl py-3.5 items-center"
          >
            <View className="flex-row items-center gap-2">
              <LogOut size={18} color="#475569" />
              <Text className="text-sm font-montserrat-bold text-textSecondary">Log Out</Text>
            </View>
          </Pressable>
          <Pressable onPress={handleDeleteAccount} className="items-center py-2">
            <View className="flex-row items-center gap-2">
              <Trash2 size={16} color="#EF4444" />
              <Text className="text-sm font-montserrat text-danger">Delete Account</Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
