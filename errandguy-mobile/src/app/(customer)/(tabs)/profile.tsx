import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  BadgeCheck,
  ChevronRight,
  Wallet,
  UserRound,
  MapPin,
  Users,
  CreditCard,
  HelpCircle,
  Flag,
  Gift,
  Ticket,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Avatar } from '../../../components/ui/Avatar';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { LogoutSplash } from '../../../components/ui/LogoutSplash';
import { InlineLogoutLink } from '../../../components/auth/InlineLogoutLink';
import { Eyebrow, Hairline } from '../../../components/ui/Typography';
import { EditProfileModal } from '../../../components/customer/EditProfileModal';
import { useAuthStore } from '../../../stores/authStore';
import { useAuth } from '../../../hooks/useAuth';
import { userService } from '../../../services/user.service';
import { prefetchPromos, prefetchReferral } from '../../../services/preload.service';
import { formatCurrency } from '../../../utils/formatCurrency';
import { LightColors } from '../../../constants/colors';
import { TAB_CONTENT_BOTTOM_INSET } from '../../../constants/tabLayout';
import { toast } from '../../../stores/toastStore';

interface MenuItem {
  label: string;
  icon: LucideIcon;
  route?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
}

// App idiom: Light impact on raw-Pressable taps (shared Button self-fires).
const lightTap = () =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

export default function CustomerProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const { logout } = useAuth();

  const [refreshing, setRefreshing] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Refresh the user record (notably wallet_balance) every time the
  // profile tab gains focus so the wallet figure isn't stale.
  const refreshUser = useCallback(async () => {
    try {
      const res = await userService.getProfile();
      if (res.data?.data) setUser(res.data.data);
    } catch {}
  }, [setUser]);

  useFocusEffect(
    useCallback(() => {
      refreshUser();
      // Warm the one-tap-away Promos & Referral screens so they paint instantly
      // when opened from here (both are deliberately excluded from the
      // first-wave auth warm-up). Best-effort. (P32)
      const uid = user?.id;
      if (uid) {
        prefetchPromos(uid);
        prefetchReferral(uid);
      }
    }, [refreshUser, user?.id]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshUser();
    setRefreshing(false);
  }, [refreshUser]);

  const confirmLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }, [logout]);

  const handleDeleteAccount = useCallback(async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setDeleting(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await userService.deleteAccount();
      // Close/reset only on success — after a transient failure the sheet
      // stays open with the typed text intact so the user just retries.
      setShowDeleteModal(false);
      setDeleteConfirmText('');
      await logout();
      router.replace('/(auth)/welcome' as any);
    } catch {
      toast.error('Failed to delete account. Please try again.');
    } finally {
      setDeleting(false);
    }
  }, [deleteConfirmText, logout, router]);

  // Profile completion — computed client-side from the user record.
  // Five checks: photo, email added, email verified, phone added,
  // phone verified. The hint line only surfaces items the edit modal
  // (where the meter routes) can actually fix — photo and email. The
  // verify/phone checks stay in the % math, but hinting them here would
  // dead-end: the modal has no phone field and no in-app verify flow is
  // reachable for an authenticated session.
  const completion = useMemo(() => {
    const checks = [
      !!user?.full_name,
      !!user?.avatar_url,
      !!user?.email,
      !!user?.phone,
    ];
    const hints: string[] = [];
    if (!user?.avatar_url) hints.push('Add a profile photo');
    if (!user?.full_name) hints.push('Add your name');
    const done = checks.filter(Boolean).length;
    return {
      percent: Math.round((done / checks.length) * 100),
      hints,
    };
  }, [user]);

  const accountMenu: MenuItem[] = [
    {
      label: 'Edit Profile',
      icon: UserRound,
      onPress: () => setShowEditModal(true),
    },
    { label: 'Saved Addresses', icon: MapPin, route: '/(customer)/addresses' },
    {
      label: 'Trusted Contacts',
      icon: Users,
      route: '/(customer)/trusted-contacts',
    },
  ];

  const paymentMenu: MenuItem[] = [
    {
      // No balance trailing — the wallet strip above owns the number;
      // repeating it here showed the same figure twice per viewport.
      label: 'Wallet',
      icon: Wallet,
      route: '/(customer)/wallet',
    },
    {
      label: 'Payment Methods',
      icon: CreditCard,
      route: '/(customer)/payment-methods',
    },
  ];

  const earnMenu: MenuItem[] = [
    { label: 'Invite friends', icon: Gift, route: '/(customer)/referral' },
    { label: 'Promos & offers', icon: Ticket, route: '/(customer)/promos' },
  ];

  const supportMenu: MenuItem[] = [
    { label: 'Help & Support', icon: HelpCircle, route: '/(customer)/help' },
    // Distinct destination from Help & Support: the in-app ticket flow.
    { label: 'Report an Issue', icon: Flag, route: '/(customer)/support' },
  ];

  const renderMenuItem = (item: MenuItem, isLast: boolean) => {
    const RowIcon = item.icon;
    return (
      <React.Fragment key={item.label}>
        <Pressable
          onPress={() => {
            if (item.onPress) item.onPress();
            else if (item.route) router.push(item.route as any);
          }}
          className="flex-row items-center py-3"
          accessibilityRole="button"
          accessibilityLabel={item.label}
        >
          {/* Leading icon chip — soft blue circle + primary icon. */}
          <View className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center mr-3">
            <RowIcon size={18} color={LightColors.primary} strokeWidth={1.9} />
          </View>
          <Text className="flex-1 text-[15px] font-montserrat-semi text-textPrimary">
            {item.label}
          </Text>
          {item.trailing ?? (
            <ChevronRight size={16} color={LightColors.textMuted} />
          )}
        </Pressable>
        {!isLast && <Hairline />}
      </React.Fragment>
    );
  };

  // Section blocks — an eyebrow label above a white Card that groups
  // the rows, hairline-separated, per the grouped-list reference.
  const renderSection = (label: string, items: MenuItem[]) => (
    <View className="px-5 mb-5">
      <Eyebrow className="mb-2">{label}</Eyebrow>
      {/* overflow-hidden clips the rows' pressed wash/ripple to the
          card's rounded corners. */}
      <Card padding="none" className="px-4 py-1">
        {items.map((item, idx) =>
          renderMenuItem(item, idx === items.length - 1),
        )}
      </Card>
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Profile" />
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingBottom: TAB_CONTENT_BOTTOM_INSET }}
      >
        {/* Profile identity row — ASYMMETRIC. Avatar left, name+email
            stacked right. No centered hero block, no "Edit Profile"
            button under the avatar (the row itself is tappable and the
            Account section below has Edit Profile as its first item). */}
        <Pressable
          className="flex-row items-center px-5 pt-4 pb-5"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          onPress={() => {
            lightTap();
            setShowEditModal(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
        >
          <Avatar uri={user?.avatar_url} name={user?.full_name} size="lg" />
          <View className="flex-1 ml-4">
            <Text
              className="text-[16px] font-montserrat-bold text-textPrimary"
              numberOfLines={1}
            >
              {user?.full_name ?? 'Customer'}
            </Text>
            {user?.email ? (
              <View className="flex-row items-center mt-0.5">
                <Text
                  className="text-[12px] font-montserrat text-textSecondary"
                  style={{ flexShrink: 1 }}
                  numberOfLines={1}
                >
                  {user.email}
                </Text>
                {user.email_verified ? (
                  <BadgeCheck
                    size={14}
                    color={LightColors.successDark}
                    style={{ marginLeft: 4 }}
                    accessibilityLabel="Email verified"
                  />
                ) : null}
              </View>
            ) : null}
            {user?.phone ? (
              <Text className="text-[12px] font-inter text-textSecondary mt-0.5">
                {user.phone}
              </Text>
            ) : null}
          </View>
          <ChevronRight size={18} color={LightColors.textMuted} />
        </Pressable>

        {/* Profile completion — slim progress row, only while below
            100%. Tapping it opens the edit modal; the hint line only
            names items the modal can fix. */}
        {completion.percent < 100 && (
          <Pressable
            onPress={() => {
              lightTap();
              setShowEditModal(true);
            }}
            className="mx-5 mb-5 -mt-1"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            accessibilityRole="button"
            accessibilityLabel={`Profile ${completion.percent} percent complete.${
              completion.hints.length > 0
                ? ` ${completion.hints.slice(0, 2).join(', ')}.`
                : ''
            } Opens edit profile`}
          >
            <View className="flex-row items-center justify-between mb-1.5">
              <Text className="text-[11px] font-montserrat-bold text-textSecondary">
                Profile {completion.percent}% complete
              </Text>
              <ChevronRight size={14} color={LightColors.textMuted} />
            </View>
            <View
              className="bg-surfaceMuted"
              style={{ height: 4, borderRadius: 2, overflow: 'hidden' }}
            >
              <View
                className="bg-primary"
                style={{
                  width: `${completion.percent}%`,
                  height: 4,
                  borderRadius: 2,
                }}
              />
            </View>
            {completion.hints.length > 0 && (
              <Text
                className="text-[12px] font-montserrat text-textTertiary mt-1.5"
                numberOfLines={1}
              >
                {completion.hints.slice(0, 2).join(' · ')}
              </Text>
            )}
          </Pressable>
        )}

        {/* Wallet — NOT a colored hero card. Hairline-bounded row with
            an asymmetric layout: large numeric balance left, top-up
            CTA right. The numeric is in Inter for crispness. */}
        <View className="mx-5 mb-6 py-4 border-y border-divider flex-row items-end">
          <Pressable
            className="flex-1"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            onPress={() => {
              lightTap();
              router.push('/(customer)/wallet' as any);
            }}
            accessibilityRole="button"
            accessibilityLabel="Open wallet"
          >
            <Eyebrow>Wallet balance</Eyebrow>
            <Text className="text-[24px] font-inter-semi text-textPrimary mt-1" style={{ lineHeight: 26, letterSpacing: -0.3 }}>
              {formatCurrency(user?.wallet_balance ?? 0)}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              lightTap();
              router.push('/(customer)/wallet/top-up' as any);
            }}
            // Quiet primaryLight pill (~40pt tall) + 4pt slop clears the
            // 44pt target minimum and matches the menu rows' chip language.
            className="flex-row items-center gap-1.5 px-3 py-2.5 rounded-full bg-primaryLight"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Add money to wallet"
          >
            <Wallet size={14} color={LightColors.primary} />
            <Text className="text-[13px] font-montserrat-bold text-primary">
              Add money
            </Text>
          </Pressable>
        </View>

        {renderSection('ACCOUNT', accountMenu)}
        {renderSection('PAYMENT', paymentMenu)}
        {renderSection('EARN & SAVE', earnMenu)}
        {renderSection('SUPPORT', supportMenu)}

        {/* Logout / Delete — inline tap-to-confirm. The previous
            bottom-sheet flow felt heavy for an action that's already
            reversible (re-login is one screen away). The inline
            link arms on first tap and confirms on the second within
            a 3s window — modern, non-disruptive, undoable. */}
        <View className="items-center pt-2 pb-4 gap-3">
          <InlineLogoutLink onConfirm={confirmLogout} />
          <Pressable
            onPress={() => {
              lightTap();
              setShowDeleteModal(true);
            }}
            // ≥44pt effective target. Top slop stays under the 12px gap
            // to the logout link above so the two never overlap.
            hitSlop={{ top: 10, bottom: 20, left: 24, right: 24 }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            accessibilityRole="button"
            accessibilityLabel="Delete account"
          >
            {/* textTertiary at 12px — textMuted measured 2.41:1, sub-AA
                for the entry to the most destructive flow in the app. */}
            <Text className="text-[12px] font-montserrat text-textTertiary underline">
              Delete account
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Delete Account Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => {
          setShowDeleteModal(false);
          setDeleteConfirmText('');
        }}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable
            className="flex-1 bg-black/40 justify-end"
            onPress={() => {
              setShowDeleteModal(false);
              setDeleteConfirmText('');
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss delete account dialog"
            accessibilityHint="Closes the dialog without deleting your account"
          >
            <Pressable
              className="bg-surface rounded-t-3xl px-5 pt-6"
              style={{ paddingBottom: insets.bottom + 16 }}
              onPress={() => {}}
            >
              <View className="w-10 h-1 rounded-full bg-divider self-center mb-5" />
              <Text className="text-base font-montserrat-bold text-textPrimary mb-1">
                Delete your account?
              </Text>
              <Text className="text-sm font-montserrat text-textTertiary mb-5">
                This can't be undone. Your bookings, wallet, and data will be
                permanently removed.
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
                loadingTitle="Deleting…"
                disabled={deleteConfirmText !== 'DELETE'}
                onPress={handleDeleteAccount}
              />
              <Button
                title="Cancel"
                variant="ghost"
                fullWidth
                onPress={() => {
                  lightTap();
                  setShowDeleteModal(false);
                  setDeleteConfirmText('');
                }}
              />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <EditProfileModal
        visible={showEditModal}
        onClose={() => setShowEditModal(false)}
      />

      <LogoutSplash visible={loggingOut} />
    </View>
  );
}
