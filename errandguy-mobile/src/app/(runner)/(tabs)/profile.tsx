import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
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
  RefreshCw,
  Info,
  type LucideIcon,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Avatar } from '../../../components/ui/Avatar';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/ErrorState';
import { LogoutSplash } from '../../../components/ui/LogoutSplash';
import { InlineLogoutLink } from '../../../components/auth/InlineLogoutLink';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { Eyebrow } from '../../../components/ui/Typography';
import { RatingStars } from '../../../components/ui/RatingStars';
import { VerificationBanner } from '../../../components/runner/VerificationBanner';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useAuthStore } from '../../../stores/authStore';
import { runnerService } from '../../../services/runner.service';
import { userService } from '../../../services/user.service';
import { toast } from '../../../stores/toastStore';
import { errorMessage } from '../../../utils/errorCatalog';
import { copy } from '../../../constants/copy';
import { haptics } from '../../../utils/haptics';
import { LightColors } from '../../../constants/colors';
import { useResponsive } from '../../../constants/responsive';
import { checkForOtaUpdate } from '../../../hooks/useOtaUpdate';
import { getAppVersionLabel } from '../../../utils/appVersion';

interface MenuItem {
  label: string;
  route?: string;
  /** Leading icon rendered in a soft blue chip. */
  icon?: LucideIcon;
  /** Optional destructive accent for the label (e.g. red "Delete"). */
  color?: string;
  /** Muted current-value preview shown before the chevron
   *  (e.g. "Motorcycle", "12 km", "Verified"). */
  preview?: string;
  /** Preview text tone. Defaults to textTertiary (AA-legible); an
   *  earning-blocking status can pass a warning/danger *Dark rung. */
  previewColor?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
}

const VEHICLE_LABELS: Record<string, string> = {
  walk: 'Walking',
  bicycle: 'Bicycle',
  motorcycle: 'Motorcycle',
  car: 'Car',
};

const VERIFICATION_LABELS: Record<string, string> = {
  approved: 'Verified',
  pending: 'Pending',
  rejected: 'Rejected',
  resubmit: 'Action needed',
};

/**
 * One runner-performance stat rendered as a full-width bar: label + value on
 * one line, a thin colour-coded fill beneath. Replaces the old three
 * side-by-side ring gauges, which crowded and clipped their inner numerals
 * on narrow widths / large font scales.
 */
function StatBar({
  label,
  value,
  fraction,
  fill,
  valueColor,
}: {
  label: string;
  value: string;
  fraction: number;
  fill: string;
  valueColor: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <View>
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-[13px] font-montserrat-semi text-textSecondary">
          {label}
        </Text>
        <Text className="text-[15px] font-inter-semi" style={{ color: valueColor }}>
          {value}
        </Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: LightColors.surfaceMuted,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            height: '100%',
            width: `${pct}%`,
            borderRadius: 3,
            backgroundColor: fill,
          }}
        />
      </View>
    </View>
  );
}

export default function RunnerProfileScreen() {
  const router = useRouter();
  const { contentMaxWidth } = useResponsive();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const { runnerProfile, setRunnerProfile } = useRunnerStore();
  const [refreshing, setRefreshing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

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
      setLoadFailed(false);
    } catch {
      // Only surface the failure when the store has nothing cached —
      // with a hydrated profile the stale numbers are still honest,
      // and the fetch retries on the next focus/refresh anyway.
      if (!useRunnerStore.getState().runnerProfile) setLoadFailed(true);
    }
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
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    try {
      await userService.deleteAccount();
      await logout();
      router.replace('/(auth)/welcome' as any);
    } catch (err: any) {
      haptics.error();
      toast.error(errorMessage(err, copy.profile.deleteAccountFailed));
    } finally {
      setDeleting(false);
      setShowDeleteModal(false);
      setDeleteConfirmText('');
    }
  }, [deleteConfirmText, logout, router]);

  const isVerified = runnerProfile?.verification_status === 'approved';

  // avg_rating 0 means "no ratings yet", not a bottom-tier score —
  // render it as unrated ("New") rather than the ambiguous "0.0".
  const avgRating = Number(user?.avg_rating ?? 0);
  const isUnrated = !avgRating;
  const ratingIsGood = avgRating >= 4.5;

  // Current-value previews sourced from the already-hydrated stores —
  // no extra fetches. Undefined previews simply render nothing.
  const vehiclePreview = runnerProfile?.vehicle_type
    ? VEHICLE_LABELS[runnerProfile.vehicle_type]
    : undefined;
  const radiusPreview =
    runnerProfile?.working_area_radius != null
      ? `${Number(runnerProfile.working_area_radius)} km`
      : undefined;
  const documentsPreview = runnerProfile?.verification_status
    ? VERIFICATION_LABELS[runnerProfile.verification_status]
    : undefined;
  // Verification is earning-gating — never let a blocked/pending state
  // read as a benign gray preview. Rejected/resubmit go danger, pending
  // goes warning; approved keeps the neutral tertiary tone.
  const documentsPreviewColor =
    runnerProfile?.verification_status === 'rejected' ||
    runnerProfile?.verification_status === 'resubmit'
      ? LightColors.dangerDark
      : runnerProfile?.verification_status === 'pending'
        ? LightColors.warningDark
        : undefined;

  const accountMenu: MenuItem[] = [
    { label: 'Edit Profile', icon: UserRound, route: '/(runner)/settings/edit-profile' },
    {
      label: 'Documents & Verification',
      icon: FileCheck2,
      route: '/(runner)/settings/documents',
      preview: documentsPreview,
      previewColor: documentsPreviewColor,
    },
    {
      label: 'Vehicle Information',
      icon: Car,
      route: '/(runner)/settings/vehicle',
      preview: vehiclePreview,
    },
    { label: 'Payout Settings', icon: Wallet, route: '/(runner)/payout' },
    { label: 'Preferred Errand Types', icon: ListChecks, route: '/(runner)/settings/preferred-types' },
    {
      label: 'Working Areas',
      icon: MapPinned,
      route: '/(runner)/settings/working-areas',
      preview: radiusPreview,
    },
  ];

  const settingsMenu: MenuItem[] = [
    { label: 'Notification Preferences', icon: Bell, route: '/(runner)/settings/notifications' },
    { label: 'Help & Support', icon: LifeBuoy, route: '/(runner)/settings/help' },
    { label: 'Terms & Privacy', icon: FileText, route: '/(runner)/settings/terms' },
    {
      label: 'Check for updates',
      icon: RefreshCw,
      onPress: () => {
        void checkForOtaUpdate({ silent: false });
      },
    },
    { label: 'App version', icon: Info, preview: getAppVersionLabel() },
  ];

  const renderMenuItem = (item: MenuItem, idx: number, arr: MenuItem[]) => (
    <Pressable
      key={item.label}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        if (item.onPress) item.onPress();
        else if (item.route) router.push(item.route as any);
      }}
      accessibilityRole="button"
      accessibilityLabel={
        item.preview ? `${item.label}, ${item.preview}` : item.label
      }
      android_ripple={{ color: `${LightColors.primary}14` }}
      style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
      className={`flex-row items-center py-3.5 ${
        idx < arr.length - 1 ? 'border-b border-divider' : ''
      }`}
    >
      {item.icon ? (
        <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center mr-3">
          <item.icon size={18} color={LightColors.primary} strokeWidth={1.9} />
        </View>
      ) : null}
      <Text
        className="flex-1 text-[14px] font-montserrat-semi text-textPrimary"
        style={item.color ? { color: item.color } : undefined}
      >
        {item.label}
      </Text>
      {item.preview ? (
        <Text
          className={`text-[12px] mr-1.5 ${
            item.previewColor ? 'font-montserrat-bold' : 'font-montserrat'
          }`}
          numberOfLines={1}
          style={{
            maxWidth: 120,
            color: item.previewColor ?? LightColors.textTertiary,
          }}
        >
          {item.preview}
        </Text>
      ) : null}
      {item.trailing ?? (
        <ChevronRight size={16} color={LightColors.textTertiary} strokeWidth={2} />
      )}
    </Pressable>
  );

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Profile" />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{
          paddingBottom: 24,
          width: '100%',
          maxWidth: contentMaxWidth,
          alignSelf: 'center',
        }}
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
              <Star size={11} color={LightColors.accentStrong} fill={LightColors.accentStrong} />
              <Text className="text-[12px] font-inter tabular-nums text-textSecondary ml-1">
                {isUnrated ? 'New' : avgRating.toFixed(1)}
              </Text>
              {runnerProfile ? (
                <Text className="text-[12px] font-montserrat text-textTertiary ml-1.5">
                  · {runnerProfile.total_errands ?? 0} errands
                </Text>
              ) : null}
            </View>
            {isVerified && (
              <View className="flex-row items-center mt-1.5">
                <BadgeCheck size={12} color={LightColors.primary} strokeWidth={2} />
                <Text className="text-[12px] font-montserrat-bold text-primary ml-1">Verified runner</Text>
              </View>
            )}
          </View>
        </View>

        {/* Verification — surfaced on the hub for every non-approved
            state (self-hides on 'approved'), since Documents &
            Verification is managed here and rejected/resubmit block
            earning. Mirrors the dashboard treatment. */}
        {runnerProfile && runnerProfile.verification_status !== 'approved' && (
          <VerificationBanner
            status={runnerProfile.verification_status}
            onAction={() => router.push('/(runner)/settings/documents' as any)}
          />
        )}

        {/* Performance — hairline-bound row, no card chrome */}
        <View className="px-5 mb-6">
          <Eyebrow className="mb-3">Performance</Eyebrow>
          {loadFailed && !runnerProfile ? (
            // The store is empty AND the refresh failed — fake 0%/0★
            // rings would read as a terrible runner, not a failed load.
            <View className="py-4 border-y border-divider">
              <ErrorState
                compact
                title="Couldn't load your stats"
                onRetry={() => {
                  setLoadFailed(false);
                  refreshAll();
                }}
              />
            </View>
          ) : (
            <>
              {/* Full-width metric bars (was three cramped ring gauges).
                  Acceptance + Completion are rates → colour-coded fill bars;
                  Rating is not a rate → its value + read-only stars. */}
              <View className="py-4 border-y border-divider" style={{ gap: 18 }}>
                <StatBar
                  label="Acceptance"
                  value={`${Math.round(runnerProfile?.acceptance_rate ?? 0)}%`}
                  fraction={(runnerProfile?.acceptance_rate ?? 0) / 100}
                  fill={
                    (runnerProfile?.acceptance_rate ?? 0) < 70
                      ? LightColors.warning
                      : LightColors.success
                  }
                  valueColor={
                    (runnerProfile?.acceptance_rate ?? 0) < 70
                      ? LightColors.warningDark
                      : LightColors.successDark
                  }
                />
                <StatBar
                  label="Completion"
                  value={`${Math.round(runnerProfile?.completion_rate ?? 0)}%`}
                  fraction={(runnerProfile?.completion_rate ?? 0) / 100}
                  fill={
                    (runnerProfile?.completion_rate ?? 0) < 80
                      ? LightColors.warning
                      : LightColors.success
                  }
                  valueColor={
                    (runnerProfile?.completion_rate ?? 0) < 80
                      ? LightColors.warningDark
                      : LightColors.successDark
                  }
                />
                <View className="flex-row items-center justify-between">
                  <Text className="text-[13px] font-montserrat-semi text-textSecondary">
                    Rating
                  </Text>
                  <View className="flex-row items-center" style={{ gap: 8 }}>
                    <Text
                      className="text-[15px] font-inter-semi"
                      style={{
                        color: isUnrated
                          ? LightColors.textTertiary
                          : ratingIsGood
                            ? LightColors.successDark
                            : LightColors.warningDark,
                      }}
                    >
                      {isUnrated ? 'New' : avgRating.toFixed(1)}
                    </Text>
                    {!isUnrated && (
                      <RatingStars value={Math.round(avgRating)} size={14} readonly />
                    )}
                  </View>
                </View>
              </View>
              <View className="flex-row items-center justify-between pt-3">
                <Text className="text-[12px] font-montserrat text-textTertiary">Member since</Text>
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
            </>
          )}
        </View>

        {/* Account Menu — list rows with icon chips inside a Card */}
        <View className="px-5 mb-4">
          <Eyebrow className="mb-3">Account</Eyebrow>
          <Card padding="sm" className="px-4">
            {accountMenu.map((item, idx, arr) => renderMenuItem(item, idx, arr))}
          </Card>
        </View>

        {/* Settings Menu */}
        <View className="px-5 mb-6">
          <Eyebrow className="mb-3">Preferences</Eyebrow>
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

        {/* Irreversible delete is spatially broken off from the
            reversible Log out above — a hairline + gap so a fast scan
            never confuses the two guarded actions. */}
        <View className="h-px bg-divider mx-5 mt-6 mb-1" />

        {/* Delete Account — simple link */}
        <Pressable
          className="items-center py-4 mb-4"
          accessibilityRole="button"
          accessibilityLabel="Delete account"
          onPress={() => {
            // Warning haptic on entering a destructive flow — the
            // confirm step fires its own Warning again before the call.
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            setShowDeleteModal(true);
          }}
        >
          <Text className="text-[12px] font-montserrat text-textTertiary underline">
            Delete account
          </Text>
        </Pressable>
      </ScrollView>

      {/* Delete Account Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable
            className="flex-1 bg-black/40 justify-end"
            accessibilityRole="button"
            accessibilityLabel="Dismiss delete account dialog"
            onPress={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
          >
            <Pressable
              className="bg-surface rounded-t-3xl px-7 pt-6 pb-12"
              accessible={false}
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
                  accessibilityLabel="Type DELETE to confirm account deletion"
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
                loadingTitle="Deleting…"
                disabled={deleteConfirmText !== 'DELETE'}
                onPress={handleDeleteAccount}
              />
              <Pressable
                className="mt-3 py-3 items-center"
                accessibilityRole="button"
                accessibilityLabel="Cancel"
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
