import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { ChevronRight, Star, BadgeCheck } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Avatar } from '../../../components/ui/Avatar';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { LoadingOverlay } from '../../../components/ui/LoadingOverlay';
import { PerformanceMetric } from '../../../components/runner/PerformanceMetric';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useAuthStore } from '../../../stores/authStore';
import { runnerService } from '../../../services/runner.service';
import { userService } from '../../../services/user.service';
import { toast } from '../../../stores/toastStore';

interface MenuItem {
  label: string;
  route?: string;
  /** Optional destructive accent for the label (e.g. red "Delete"). */
  color?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
}

export default function RunnerProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const { runnerProfile, setRunnerProfile } = useRunnerStore();
  const [refreshing, setRefreshing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Pull both the runner profile (acceptance_rate, completion_rate,
  // total_errands) and the user record (wallet_balance, avg_rating)
  // in parallel — either alone leaves part of the screen stale.
  const refreshAll = useCallback(async () => {
    try {
      const [runnerRes, userRes] = await Promise.all([
        runnerService.getRunnerProfile(),
        userService.getProfile(),
      ]);
      setRunnerProfile(runnerRes.data.data);
      if (userRes.data?.data) setUser(userRes.data.data);
    } catch {}
  }, [setRunnerProfile, setUser]);

  useFocusEffect(
    useCallback(() => {
      refreshAll();
    }, [refreshAll]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  }, [refreshAll]);

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const confirmLogout = async () => {
    setShowLogoutModal(false);
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      router.replace('/(auth)/welcome' as any);
    }
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
      toast.error('Failed to delete account. Please try again.');
    } finally {
      setDeleting(false);
      setShowDeleteModal(false);
      setDeleteConfirmText('');
    }
  }, [deleteConfirmText, logout, router]);

  const isVerified = runnerProfile?.verification_status === 'approved';

  const accountMenu: MenuItem[] = [
    { label: 'Edit Profile', route: '/(runner)/settings/edit-profile' },
    { label: 'Documents & Verification', route: '/(runner)/settings/documents' },
    { label: 'Vehicle Information', route: '/(runner)/settings/vehicle' },
    { label: 'Payout Settings', route: '/(runner)/payout' },
    { label: 'Preferred Errand Types', route: '/(runner)/settings/preferred-types' },
    { label: 'Working Areas', route: '/(runner)/settings/working-areas' },
  ];

  const settingsMenu: MenuItem[] = [
    { label: 'Notification Preferences', route: '/(runner)/settings/notifications' },
    { label: 'Help & Support', route: '/(runner)/settings/help' },
    { label: 'Terms & Privacy', route: '/(runner)/settings/terms' },
  ];

  const renderMenuItem = (item: MenuItem, _idx: number, _arr: MenuItem[]) => (
    <Pressable
      key={item.label}
      onPress={() => {
        if (item.onPress) item.onPress();
        else if (item.route) router.push(item.route as any);
      }}
      className="flex-row items-center justify-between py-4"
    >
      <Text
        className="text-[15px] font-montserrat text-textPrimary"
        style={item.color ? { color: item.color } : undefined}
      >
        {item.label}
      </Text>
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
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* Profile Header */}
        <View className="items-center px-5 mb-6">
          <Avatar uri={user?.avatar_url} name={user?.full_name} size="xl" />
          <Text className="text-lg font-montserrat-bold text-textPrimary mt-3">
            {user?.full_name ?? 'Runner'}
          </Text>
          <View className="flex-row items-center gap-1.5 mt-0.5">
            <Star size={12} color="#F59E0B" fill="#F59E0B" />
            <Text className="text-xs font-montserrat text-textTertiary">
              {Number(user?.avg_rating ?? 0).toFixed(1)} · {runnerProfile?.total_errands ?? 0} errands
            </Text>
          </View>
          {isVerified && (
            <View className="flex-row items-center gap-1 mt-2">
              <BadgeCheck size={14} color="#2563EB" />
              <Text className="text-xs font-montserrat-bold text-primary">Verified Runner</Text>
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
                value={Number(user?.avg_rating ?? 0).toFixed(1)}
                label="Rating"
                color="#F59E0B"
                suffix="★"
              />
            </View>
            <View className="flex-row items-center justify-between pt-2 border-t border-divider">
              <Text className="text-xs font-montserrat text-textTertiary">Member since</Text>
              <Text className="text-xs font-montserrat-bold text-textPrimary">
                {(() => {
                  const raw = runnerProfile?.created_at;
                  if (!raw) return 'New member';
                  const d = new Date(raw);
                  if (isNaN(d.getTime())) return 'New member';
                  return d.toLocaleDateString([], { month: 'short', year: 'numeric' });
                })()}
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
            className="bg-surface rounded-2xl py-4 items-center"
            style={{ shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 }}
          >
            <Text className="text-[15px] font-montserrat-semi text-textSecondary">Log Out</Text>
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
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
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
                  style={{ fontFamily: 'Quicksand_400Regular', fontSize: 15, color: '#0F172A' }}
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
        </KeyboardAvoidingView>
      </Modal>

      <ConfirmModal
        visible={showLogoutModal}
        title="Log out?"
        message="You'll go offline immediately and stop receiving errand requests."
        confirmLabel="Log out"
        cancelLabel="Stay signed in"
        destructive
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutModal(false)}
      />

      <LoadingOverlay isVisible={loggingOut} message="Signing you out…" />
    </SafeAreaView>
  );
}
