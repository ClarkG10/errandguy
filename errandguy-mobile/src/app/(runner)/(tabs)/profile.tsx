import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  ChevronRight,
  Star,
  BadgeCheck,
  UserRound,
  FileCheck2,
  Car,
  Wallet,
  ListChecks,
  MapPinned,
  Bell,
  LifeBuoy,
  FileText,
  type LucideIcon,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Avatar } from '../../../components/ui/Avatar';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { LogoutSplash } from '../../../components/ui/LogoutSplash';
import { InlineLogoutLink } from '../../../components/auth/InlineLogoutLink';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { PerformanceMetric } from '../../../components/runner/PerformanceMetric';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useAuthStore } from '../../../stores/authStore';
import { runnerService } from '../../../services/runner.service';
import { userService } from '../../../services/user.service';
import { toast } from '../../../stores/toastStore';
import { LightColors } from '../../../constants/colors';

interface MenuItem {
  label: string;
  route?: string;
  /** Leading icon rendered in a soft blue chip. */
  icon?: LucideIcon;
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

  const confirmLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      router.replace('/(auth)/welcome' as any);
    }
  }, [logout, router]);

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
    { label: 'Edit Profile', icon: UserRound, route: '/(runner)/settings/edit-profile' },
    { label: 'Documents & Verification', icon: FileCheck2, route: '/(runner)/settings/documents' },
    { label: 'Vehicle Information', icon: Car, route: '/(runner)/settings/vehicle' },
    { label: 'Payout Settings', icon: Wallet, route: '/(runner)/payout' },
    { label: 'Preferred Errand Types', icon: ListChecks, route: '/(runner)/settings/preferred-types' },
    { label: 'Working Areas', icon: MapPinned, route: '/(runner)/settings/working-areas' },
  ];

  const settingsMenu: MenuItem[] = [
    { label: 'Notification Preferences', icon: Bell, route: '/(runner)/settings/notifications' },
    { label: 'Help & Support', icon: LifeBuoy, route: '/(runner)/settings/help' },
    { label: 'Terms & Privacy', icon: FileText, route: '/(runner)/settings/terms' },
  ];

  const renderMenuItem = (item: MenuItem, idx: number, arr: MenuItem[]) => (
    <Pressable
      key={item.label}
      onPress={() => {
        if (item.onPress) item.onPress();
        else if (item.route) router.push(item.route as any);
      }}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      className={`flex-row items-center py-3.5 ${
        idx < arr.length - 1 ? 'border-b border-divider' : ''
      }`}
    >
      {item.icon ? (
        <View className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center mr-3">
          <item.icon size={18} color={LightColors.primary} strokeWidth={1.8} />
        </View>
      ) : null}
      <Text
        className="flex-1 text-[14px] font-montserrat-semi text-textPrimary"
        style={item.color ? { color: item.color } : undefined}
      >
        {item.label}
      </Text>
      {item.trailing ?? (
        <ChevronRight size={16} color={LightColors.textMuted} strokeWidth={1.5} />
      )}
    </Pressable>
  );

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Profile" />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* Asymmetric identity row — avatar left, name + meta right.
            No centered hero card. */}
        <View className="flex-row items-center px-5 pt-2 pb-5">
          <Avatar uri={user?.avatar_url} name={user?.full_name} size="lg" />
          <View className="flex-1 ml-4">
            <Text className="text-[18px] font-montserrat-bold text-textPrimary" numberOfLines={1}>
              {user?.full_name ?? 'Runner'}
            </Text>
            <View className="flex-row items-center mt-1">
              <Star size={11} color={LightColors.warning} fill={LightColors.warning} />
              <Text className="text-[12px] font-inter tabular-nums text-textSecondary ml-1">
                {Number(user?.avg_rating ?? 0).toFixed(1)}
              </Text>
              <Text className="text-[12px] font-montserrat text-textMuted ml-1.5">
                · {runnerProfile?.total_errands ?? 0} errands
              </Text>
            </View>
            {isVerified && (
              <View className="flex-row items-center mt-1.5">
                <BadgeCheck size={12} color={LightColors.primary} strokeWidth={2} />
                <Text className="text-[11px] font-montserrat-bold text-primary ml-1">Verified runner</Text>
              </View>
            )}
          </View>
        </View>

        {/* Performance — hairline-bound row, no card chrome */}
        <View className="px-5 mb-6">
          <Text className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-3" style={{ letterSpacing: 1.4 }}>
            Performance
          </Text>
          <View className="flex-row py-4 border-y border-divider">
            <PerformanceMetric
              value={runnerProfile?.acceptance_rate ?? 0}
              label="Acceptance"
              color={
                (runnerProfile?.acceptance_rate ?? 0) < 70
                  ? LightColors.warning
                  : LightColors.success
              }
            />
            <PerformanceMetric
              value={runnerProfile?.completion_rate ?? 0}
              label="Completion"
              color={
                (runnerProfile?.completion_rate ?? 0) < 80
                  ? LightColors.warning
                  : LightColors.success
              }
            />
            <PerformanceMetric
              value={Number(user?.avg_rating ?? 0).toFixed(1)}
              label="Rating"
              color={LightColors.warning}
              suffix="★"
            />
          </View>
          <View className="flex-row items-center justify-between pt-3">
            <Text className="text-[12px] font-montserrat text-textMuted">Member since</Text>
            <Text className="text-[12px] font-montserrat-bold text-textPrimary">
              {(() => {
                const raw = runnerProfile?.created_at;
                if (!raw) return 'New member';
                const d = new Date(raw);
                if (isNaN(d.getTime())) return 'New member';
                return d.toLocaleDateString([], { month: 'short', year: 'numeric' });
              })()}
            </Text>
          </View>
        </View>

        {/* Account Menu — list rows with icon chips inside a Card */}
        <View className="px-5 mb-4">
          <Text className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-2" style={{ letterSpacing: 1.4 }}>
            Account
          </Text>
          <Card padding="sm" className="px-4">
            {accountMenu.map((item, idx, arr) => renderMenuItem(item, idx, arr))}
          </Card>
        </View>

        {/* Settings Menu */}
        <View className="px-5 mb-6">
          <Text className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-2" style={{ letterSpacing: 1.4 }}>
            Preferences
          </Text>
          <Card padding="sm" className="px-4">
            {settingsMenu.map((item, idx, arr) => renderMenuItem(item, idx, arr))}
          </Card>
        </View>

        {/* Logout — inline tap-to-confirm. Replaces the prior
            bottom-sheet flow. Modern, non-disruptive, and the action
            is reversible (re-login is one screen away). */}
        <View className="px-5 pt-2 items-center">
          <InlineLogoutLink onConfirm={confirmLogout} />
        </View>

        {/* Delete Account — simple link */}
        <Pressable
          className="items-center py-5 mb-4"
          onPress={() => setShowDeleteModal(true)}
        >
          <Text className="text-[12px] font-montserrat text-textMuted underline">
            Delete account
          </Text>
        </Pressable>
      </ScrollView>

      {/* Delete Account Modal */}
      <Modal visible={showDeleteModal} transparent animationType="slide">
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable
            className="flex-1 bg-black/40 justify-end"
            onPress={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
          >
            <Pressable
              className="bg-surface px-7 pt-6 pb-12"
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
                  placeholderTextColor={LightColors.textMuted}
                  autoCapitalize="characters"
                  style={{
                    fontFamily: 'Quicksand_400Regular',
                    fontSize: 15,
                    color: LightColors.textPrimary,
                  }}
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

      <LogoutSplash visible={loggingOut} />
    </View>
  );
}
