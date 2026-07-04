import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  ChevronRight,
  Wallet,
  UserRound,
  MapPin,
  Users,
  CreditCard,
  HelpCircle,
  Flag,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Avatar } from '../../../components/ui/Avatar';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { LogoutSplash } from '../../../components/ui/LogoutSplash';
import { InlineLogoutLink } from '../../../components/auth/InlineLogoutLink';
import { Eyebrow, Hairline } from '../../../components/ui/Typography';
import { EditProfileModal } from '../../../components/customer/EditProfileModal';
import { useAuthStore } from '../../../stores/authStore';
import { useAuth } from '../../../hooks/useAuth';
import { userService } from '../../../services/user.service';
import { formatCurrency } from '../../../utils/formatCurrency';
import { LightColors } from '../../../constants/colors';
import { toast } from '../../../stores/toastStore';

interface MenuItem {
  label: string;
  icon: LucideIcon;
  route?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
}

export default function CustomerProfileScreen() {
  const router = useRouter();
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
    }, [refreshUser]),
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
      label: 'Wallet',
      icon: Wallet,
      route: '/(customer)/wallet',
      trailing: (
        <View className="flex-row items-center">
          <Text className="text-[13px] font-inter-semi text-primary mr-2">
            {formatCurrency(user?.wallet_balance ?? 0)}
          </Text>
          <ChevronRight size={16} color={LightColors.textMuted} />
        </View>
      ),
    },
    {
      label: 'Payment Methods',
      icon: CreditCard,
      route: '/(customer)/wallet',
    },
  ];

  const supportMenu: MenuItem[] = [
    { label: 'Help & Support', icon: HelpCircle, route: '/(customer)/help' },
    { label: 'Report an Issue', icon: Flag, route: '/(customer)/help' },
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* Profile identity row — ASYMMETRIC. Avatar left, name+email
            stacked right. No centered hero block, no "Edit Profile"
            button under the avatar (the row itself is tappable and the
            Account section below has Edit Profile as its first item). */}
        <Pressable
          className="flex-row items-center px-5 pt-4 pb-5"
          onPress={() => setShowEditModal(true)}
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
              <Text
                className="text-[12px] font-montserrat text-textSecondary mt-0.5"
                numberOfLines={1}
              >
                {user.email}
              </Text>
            ) : null}
            {user?.phone ? (
              <Text className="text-[12px] font-inter text-textSecondary mt-0.5">
                {user.phone}
              </Text>
            ) : null}
          </View>
          <ChevronRight size={18} color={LightColors.textMuted} />
        </Pressable>

        {/* Wallet — NOT a colored hero card. Hairline-bounded row with
            an asymmetric layout: large numeric balance left, top-up
            CTA right. The numeric is in Inter for crispness. */}
        <View className="mx-5 mb-6 py-4 border-y border-divider flex-row items-end">
          <Pressable
            className="flex-1"
            onPress={() => router.push('/(customer)/wallet' as any)}
            accessibilityRole="button"
            accessibilityLabel="Open wallet"
          >
            <Eyebrow>Wallet balance</Eyebrow>
            <Text className="text-[24px] font-inter-semi text-textPrimary mt-1" style={{ lineHeight: 26, letterSpacing: -0.3 }}>
              {formatCurrency(user?.wallet_balance ?? 0)}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/(customer)/wallet/top-up' as any)}
            className="flex-row items-center gap-1.5"
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Top up wallet"
          >
            <Wallet size={14} color={LightColors.primary} />
            <Text className="text-[12px] font-montserrat-bold text-primary underline">
              Top up
            </Text>
          </Pressable>
        </View>

        {renderSection('ACCOUNT', accountMenu)}
        {renderSection('PAYMENT', paymentMenu)}
        {renderSection('SUPPORT', supportMenu)}

        {/* Logout / Delete — inline tap-to-confirm. The previous
            bottom-sheet flow felt heavy for an action that's already
            reversible (re-login is one screen away). The inline
            link arms on first tap and confirms on the second within
            a 3s window — modern, non-disruptive, undoable. */}
        <View className="items-center pt-2 pb-4 gap-3">
          <InlineLogoutLink onConfirm={confirmLogout} />
          <Pressable
            onPress={() => setShowDeleteModal(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Delete account"
          >
            <Text className="text-[11px] font-montserrat text-textMuted underline">
              Delete account
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Delete Account Modal */}
      <Modal visible={showDeleteModal} transparent animationType="slide">
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
                  placeholderTextColor={LightColors.dividerStrong}
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
                onPress={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmText('');
                }}
              >
                <Text className="text-sm font-montserrat-bold text-textTertiary">
                  Cancel
                </Text>
              </Pressable>
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
