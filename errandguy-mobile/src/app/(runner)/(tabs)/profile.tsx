import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, RefreshControl, Modal, TextInput } from 'react-native';
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
import * as Haptics from 'expo-haptics';
import { Avatar } from '../../../components/ui/Avatar';
import { Badge } from '../../../components/ui/Badge';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { PerformanceMetric } from '../../../components/runner/PerformanceMetric';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useAuthStore } from '../../../stores/authStore';
import { runnerService } from '../../../services/runner.service';
import { userService } from '../../../services/user.service';
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
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

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
        onPress: async () => {
          try {
            await logout();
          } finally {
            router.replace('/(auth)/welcome' as any);
          }
        },
      },
    ]);
  };

  const handleDeleteAccount = useCallback(async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setDeleting(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await userService.deleteAccount();
      await logout();
      router.replace('/(auth)/welcome' as any);
    } catch {
      Alert.alert('Error', 'Failed to delete account. Please try again.');
    } finally {
      setDeleting(false);
      setShowDeleteModal(false);
      setDeleteConfirmText('');
    }
  }, [deleteConfirmText, logout, router]);

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
        <View
          className="w-9 h-9 rounded-xl items-center justify-center"
          style={{ backgroundColor: item.color ? item.color + '15' : '#EFF6FF' }}
        >
          <item.icon size={18} color={item.color ?? '#2563EB'} />
        </View>
        <Text
          className="text-sm font-montserrat text-textPrimary"
          style={item.color ? { color: item.color } : undefined}
        >
          {item.label}
        </Text>
      </View>
      {item.trailing ?? <ChevronRight size={16} color="#CBD5E1" />}
    </Pressable>
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="px-5 pt-4 pb-2">
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
          <Text className="text-lg font-montserrat-bold text-textPrimary mt-3">
            {user?.full_name ?? 'Runner'}
          </Text>
          <Text className="text-xs font-montserrat text-textTertiary mt-0.5">
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
          <Text className="text-[11px] font-montserrat-semi text-textTertiary uppercase tracking-wider mb-3 ml-0.5">Performance</Text>
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
              <Text className="text-xs font-montserrat text-textTertiary">Member since</Text>
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
          <Text className="text-[11px] font-montserrat-semi text-textTertiary uppercase tracking-wider mb-1 ml-0.5">Account</Text>
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
          <Text className="text-[11px] font-montserrat-semi text-textTertiary uppercase tracking-wider mb-1 ml-0.5">Settings</Text>
          <Card className="px-4">
            {settingsMenu.map((item, idx, arr) => (
              <View key={item.label}>
                {renderMenuItem(item, idx, arr)}
                {idx < arr.length - 1 && <View className="border-b border-divider" />}
              </View>
            ))}
          </Card>
        </View>

        {/* Logout */}
        <View className="px-5 mb-4">
          <Pressable
            onPress={handleLogout}
            className="bg-surface rounded-2xl py-3.5 items-center"
            style={{ shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 }}
          >
            <View className="flex-row items-center gap-2">
              <LogOut size={18} color="#475569" />
              <Text className="text-sm font-montserrat-semi text-textTertiary">Log Out</Text>
            </View>
          </Pressable>
        </View>

        {/* Delete Account — simple link */}
        <Pressable
          className="items-center py-4 mb-8"
          onPress={() => setShowDeleteModal(true)}
        >
          <Text className="text-xs font-montserrat text-textTertiary underline">
            Delete Account
          </Text>
        </Pressable>
      </ScrollView>

      {/* Delete Account Modal */}
      <Modal visible={showDeleteModal} transparent animationType="slide">
        <Pressable
          className="flex-1 bg-black/40 justify-end"
          onPress={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
        >
          <Pressable
            className="bg-surface rounded-t-3xl px-6 pt-5 pb-10"
            onPress={() => {}}
          >
            <View className="w-10 h-1 rounded-full bg-divider self-center mb-5" />
            <Text className="text-base font-montserrat-bold text-textPrimary mb-1">
              Delete your account?
            </Text>
            <Text className="text-sm font-montserrat text-textTertiary mb-5">
              This can't be undone. Your earnings, errand history, and data will be permanently removed.
            </Text>
            <Text className="text-xs font-montserrat-bold text-textSecondary mb-2">
              Type DELETE to confirm
            </Text>
            <View className="border border-divider rounded-xl px-4 h-12 justify-center mb-5 bg-background">
              <TextInput
                value={deleteConfirmText}
                onChangeText={setDeleteConfirmText}
                placeholder="DELETE"
                placeholderTextColor="#CBD5E1"
                autoCapitalize="characters"
                style={{ fontFamily: 'Inter_400Regular', fontSize: 15, color: '#0F172A' }}
              />
            </View>
            <Button
              title="Delete Account"
              variant="danger"
              fullWidth
              loading={deleting}
              disabled={deleteConfirmText !== 'DELETE'}
              onPress={handleDeleteAccount}
            />
            <Pressable
              className="mt-3 py-3 items-center"
              onPress={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
            >
              <Text className="text-sm font-montserrat-bold text-textTertiary">Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
