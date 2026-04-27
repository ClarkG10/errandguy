import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, Modal, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import {
  User,
  MapPin,
  Users,
  CreditCard,
  Wallet,
  HelpCircle,
  AlertTriangle,
  LogOut,
  Trash2,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../../stores/authStore';
import { useAuth } from '../../../hooks/useAuth';
import { userService } from '../../../services/user.service';
import { Avatar } from '../../../components/ui/Avatar';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { ProfileMenuItem } from '../../../components/customer/ProfileMenuItem';
import { EditProfileModal } from '../../../components/customer/EditProfileModal';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { formatCurrency } from '../../../utils/formatCurrency';
import { toast } from '../../../stores/toastStore';

export default function ProfileScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { logout } = useAuth();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleLogout = useCallback(() => {
    setShowLogoutModal(true);
  }, []);

  const confirmLogout = useCallback(async () => {
    setShowLogoutModal(false);
    await logout();
  }, [logout]);

  const handleDeleteAccount = useCallback(async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setDeleting(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await userService.deleteAccount();
      await logout();
      router.replace('/(auth)/welcome');
    } catch {
      toast.error('Failed to delete account. Please try again.');
    } finally {
      setDeleting(false);
      setShowDeleteModal(false);
      setDeleteConfirmText('');
    }
  }, [deleteConfirmText, logout, router]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Profile Header */}
        <View className="items-center pt-6 pb-5">
          <Avatar
            uri={user?.avatar_url}
            name={user?.full_name}
            size="xl"
          />
          <Text className="text-lg font-montserrat-semi text-textPrimary mt-3">
            {user?.full_name}
          </Text>
          {user?.email && (
            <Text className="text-xs font-montserrat text-textTertiary mt-0.5">
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

        {/* Account Section */}
        <View className="px-5 mb-4">
          <Text className="text-[11px] font-montserrat-semi text-textTertiary uppercase tracking-wider mb-2 ml-1">
            Account
          </Text>
          <Card>
            <ProfileMenuItem
              icon={User}
              label="Edit Profile"
              onPress={() => setShowEditModal(true)}
            />
            <View className="h-px bg-divider mx-1" />
            <ProfileMenuItem
              icon={MapPin}
              label="Saved Addresses"
              onPress={() => router.push('/(customer)/addresses' as any)}
            />
            <View className="h-px bg-divider mx-1" />
            <ProfileMenuItem
              icon={Users}
              label="Trusted Contacts"
              onPress={() => router.push('/(customer)/trusted-contacts' as any)}
            />
          </Card>
        </View>

        {/* Payment Section */}
        <View className="px-5 mb-4">
          <Text className="text-[11px] font-montserrat-semi text-textTertiary uppercase tracking-wider mb-2 ml-1">
            Payment
          </Text>
          <Card>
            <ProfileMenuItem
              icon={CreditCard}
              label="Payment Methods"
              onPress={() => router.push('/(customer)/wallet' as any)}
            />
            <View className="h-px bg-divider mx-1" />
            <ProfileMenuItem
              icon={Wallet}
              label={`Wallet (${formatCurrency(user?.wallet_balance ?? 0)})`}
              onPress={() => router.push('/(customer)/wallet' as any)}
            />
          </Card>
        </View>

        {/* Support Section */}
        <View className="px-5 mb-4">
          <Text className="text-[11px] font-montserrat-semi text-textTertiary uppercase tracking-wider mb-2 ml-1">
            Support
          </Text>
          <Card>
            <ProfileMenuItem
              icon={HelpCircle}
              label="Help Center"
              onPress={() => {}}
            />
            <View className="h-px bg-divider mx-1" />
            <ProfileMenuItem
              icon={AlertTriangle}
              label="Report an Issue"
              onPress={() => {}}
            />
          </Card>
        </View>

        {/* Logout */}
        <View className="px-5 mb-4">
          <Card>
            <ProfileMenuItem
              icon={LogOut}
              label="Logout"
              danger
              onPress={handleLogout}
            />
          </Card>
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
            <Text className="text-base font-montserrat-semi text-textPrimary mb-1">
              Delete your account?
            </Text>
            <Text className="text-sm font-montserrat text-textTertiary mb-5">
              This can't be undone. Your bookings, wallet, and data will be permanently removed.
            </Text>
            <Text className="text-xs font-montserrat-semi text-textSecondary mb-2">
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
              <Text className="text-sm font-montserrat-semi text-textTertiary">Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
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
    </SafeAreaView>
  );
}
