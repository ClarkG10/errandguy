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
import { ChevronRight, Wallet } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Avatar } from '../../../components/ui/Avatar';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { LoadingOverlay } from '../../../components/ui/LoadingOverlay';
import { EditProfileModal } from '../../../components/customer/EditProfileModal';
import { useAuthStore } from '../../../stores/authStore';
import { useAuth } from '../../../hooks/useAuth';
import { userService } from '../../../services/user.service';
import { formatCurrency } from '../../../utils/formatCurrency';
import { toast } from '../../../stores/toastStore';

interface MenuItem {
  label: string;
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
  const [showLogoutModal, setShowLogoutModal] = useState(false);
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

  const handleLogout = () => setShowLogoutModal(true);

  const confirmLogout = async () => {
    setShowLogoutModal(false);
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
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

  const accountMenu: MenuItem[] = [
    { label: 'Edit Profile', onPress: () => setShowEditModal(true) },
    { label: 'Saved Addresses', route: '/(customer)/addresses' },
    { label: 'Trusted Contacts', route: '/(customer)/trusted-contacts' },
  ];

  const paymentMenu: MenuItem[] = [
    {
      label: 'Wallet',
      route: '/(customer)/wallet',
      trailing: (
        <View className="flex-row items-center">
          <Text className="text-[13px] font-montserrat-bold text-primary mr-2">
            {formatCurrency(user?.wallet_balance ?? 0)}
          </Text>
          <ChevronRight size={16} color="#CBD5E1" />
        </View>
      ),
    },
    { label: 'Payment Methods', route: '/(customer)/wallet' },
  ];

  const supportMenu: MenuItem[] = [
    { label: 'Help & Support', route: '/(customer)/help' },
    { label: 'Report an Issue', route: '/(customer)/help' },
  ];

  const renderMenuItem = (item: MenuItem) => (
    <Pressable
      key={item.label}
      onPress={() => {
        if (item.onPress) item.onPress();
        else if (item.route) router.push(item.route as any);
      }}
      className="flex-row items-center justify-between py-4"
    >
      <Text className="text-[15px] font-montserrat text-textPrimary">
        {item.label}
      </Text>
      {item.trailing ?? <ChevronRight size={16} color="#CBD5E1" />}
    </Pressable>
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="px-5 pt-4 pb-2">
        <Text className="text-lg font-montserrat-bold text-textPrimary">
          Profile
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* Profile Header */}
        <View className="items-center px-5 mb-6">
          <Avatar uri={user?.avatar_url} name={user?.full_name} size="xl" />
          <Text className="text-lg font-montserrat-bold text-textPrimary mt-3">
            {user?.full_name ?? 'Customer'}
          </Text>
          {user?.email && (
            <Text className="text-xs font-montserrat text-textTertiary mt-1">
              {user.email}
            </Text>
          )}
          {user?.phone && (
            <Text className="text-xs font-montserrat text-textTertiary mt-0.5">
              {user.phone}
            </Text>
          )}
          <View className="mt-3">
            <Button
              title="Edit Profile"
              variant="outline"
              size="sm"
              onPress={() => setShowEditModal(true)}
            />
          </View>
        </View>

        {/* Wallet quick card */}
        <View className="px-5 mb-4">
          <Pressable
            onPress={() => router.push('/(customer)/wallet' as any)}
            className="bg-primary rounded-2xl p-4 flex-row items-center"
          >
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
            >
              <Wallet size={18} color="#FFFFFF" />
            </View>
            <View className="flex-1">
              <Text className="text-[11px] font-montserrat text-white/80">
                Wallet balance
              </Text>
              <Text className="text-lg font-montserrat-bold text-white mt-0.5">
                {formatCurrency(user?.wallet_balance ?? 0)}
              </Text>
            </View>
            <Text className="text-xs font-montserrat-bold text-white">
              Top up
            </Text>
            <ChevronRight size={16} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* Account */}
        <View className="px-5 mb-4">
          <Text className="text-[11px] font-montserrat-semi text-textTertiary uppercase tracking-wider mb-1 ml-0.5">
            Account
          </Text>
          <Card className="px-4">
            {accountMenu.map((item, idx, arr) => (
              <View key={item.label}>
                {renderMenuItem(item)}
                {idx < arr.length - 1 && (
                  <View className="border-b border-divider" />
                )}
              </View>
            ))}
          </Card>
        </View>

        {/* Payment */}
        <View className="px-5 mb-4">
          <Text className="text-[11px] font-montserrat-semi text-textTertiary uppercase tracking-wider mb-1 ml-0.5">
            Payment
          </Text>
          <Card className="px-4">
            {paymentMenu.map((item, idx, arr) => (
              <View key={item.label}>
                {renderMenuItem(item)}
                {idx < arr.length - 1 && (
                  <View className="border-b border-divider" />
                )}
              </View>
            ))}
          </Card>
        </View>

        {/* Support */}
        <View className="px-5 mb-6">
          <Text className="text-[11px] font-montserrat-semi text-textTertiary uppercase tracking-wider mb-1 ml-0.5">
            Support
          </Text>
          <Card className="px-4">
            {supportMenu.map((item, idx, arr) => (
              <View key={item.label}>
                {renderMenuItem(item)}
                {idx < arr.length - 1 && (
                  <View className="border-b border-divider" />
                )}
              </View>
            ))}
          </Card>
        </View>

        {/* Logout */}
        <View className="px-5 mb-4">
          <Pressable
            onPress={handleLogout}
            className="bg-surface rounded-2xl py-4 items-center"
            style={{
              shadowColor: '#0F172A',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.04,
              shadowRadius: 8,
              elevation: 1,
            }}
          >
            <Text className="text-[15px] font-montserrat-semi text-textSecondary">
              Log Out
            </Text>
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
            onPress={() => {
              setShowDeleteModal(false);
              setDeleteConfirmText('');
            }}
          >
            <Pressable
              className="bg-surface rounded-t-2xl px-6 pt-5 pb-10"
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
                  placeholderTextColor="#CBD5E1"
                  autoCapitalize="characters"
                  style={{
                    fontFamily: 'Quicksand_400Regular',
                    fontSize: 15,
                    color: '#0F172A',
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

      <ConfirmModal
        visible={showLogoutModal}
        title="Log out?"
        message="You'll need to sign in again to access your account."
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
