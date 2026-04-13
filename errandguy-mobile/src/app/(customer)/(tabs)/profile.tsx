import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, Alert, TextInput, Modal, Pressable } from 'react-native';
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
  ShieldAlert,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../../stores/authStore';
import { userService } from '../../../services/user.service';
import { Avatar } from '../../../components/ui/Avatar';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { ProfileMenuItem } from '../../../components/customer/ProfileMenuItem';
import { EditProfileModal } from '../../../components/customer/EditProfileModal';
import { formatCurrency } from '../../../utils/formatCurrency';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleLogout = useCallback(() => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/welcome');
        },
      },
    ]);
  }, [logout, router]);

  const handleDeleteAccount = useCallback(async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setDeleting(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await userService.deleteAccount();
      await logout();
      router.replace('/(auth)/welcome');
    } catch {
      Alert.alert('Error', 'Failed to delete account. Please try again.');
    } finally {
      setDeleting(false);
      setShowDeleteModal(false);
      setDeleteConfirmText('');
    }
  }, [deleteConfirmText, logout, router]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Profile Header */}
        <View className="items-center pt-6 pb-5">
          <Avatar
            uri={user?.avatar_url}
            name={user?.full_name}
            size="xl"
          />
          <Text className="text-lg font-montserrat-bold text-textPrimary mt-3">
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
          <Text className="text-[11px] font-montserrat-bold text-textTertiary uppercase tracking-wider mb-2 ml-1">
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
          <Text className="text-[11px] font-montserrat-bold text-textTertiary uppercase tracking-wider mb-2 ml-1">
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
          <Text className="text-[11px] font-montserrat-bold text-textTertiary uppercase tracking-wider mb-2 ml-1">
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

        {/* Danger Zone — Delete Account (visually separated) */}
        <View className="px-5 mt-6 mb-8">
          <View className="border border-danger/20 rounded-2xl bg-danger/5 p-4">
            <View className="flex-row items-center mb-2">
              <ShieldAlert size={16} color="#EF4444" />
              <Text className="text-xs font-montserrat-bold text-danger ml-1.5 uppercase tracking-wider">
                Danger Zone
              </Text>
            </View>
            <Text className="text-xs font-montserrat text-textTertiary mb-3">
              Deleting your account is permanent. All data, bookings, and wallet balance will be lost forever.
            </Text>
            <Pressable
              className="flex-row items-center justify-center border border-danger/30 rounded-full py-2.5 px-4"
              onPress={() => setShowDeleteModal(true)}
            >
              <Trash2 size={14} color="#EF4444" />
              <Text className="text-xs font-montserrat-bold text-danger ml-1.5">
                Delete My Account
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Delete Account Confirmation Modal */}
      <Modal visible={showDeleteModal} transparent animationType="fade">
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
        >
          <Pressable
            className="bg-surface rounded-t-3xl px-6 pt-6 pb-10"
            onPress={() => {}}
          >
            <View className="w-12 h-12 rounded-full bg-danger/10 items-center justify-center self-center mb-4">
              <Trash2 size={22} color="#EF4444" />
            </View>
            <Text className="text-lg font-montserrat-bold text-textPrimary text-center mb-1">
              Delete Account?
            </Text>
            <Text className="text-sm font-montserrat text-textTertiary text-center mb-5">
              This action is irreversible. All your data, bookings, wallet balance, and trusted contacts will be permanently removed.
            </Text>
            <Text className="text-xs font-montserrat-bold text-textPrimary mb-2">
              Type "DELETE" to confirm:
            </Text>
            <View className="border border-divider rounded-2xl px-4 h-12 justify-center mb-4 bg-background">
              <TextInput
                value={deleteConfirmText}
                onChangeText={setDeleteConfirmText}
                placeholder="Type DELETE here"
                placeholderTextColor="#CBD5E1"
                autoCapitalize="characters"
                style={{ fontFamily: 'Outfit_400Regular', fontSize: 15, color: '#0F172A' }}
              />
            </View>
            <Button
              title="Permanently Delete Account"
              variant="danger"
              fullWidth
              loading={deleting}
              disabled={deleteConfirmText !== 'DELETE'}
              onPress={handleDeleteAccount}
            />
            <Pressable
              className="mt-3 py-2 items-center"
              onPress={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
            >
              <Text className="text-sm font-montserrat-bold text-textTertiary">Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <EditProfileModal
        visible={showEditModal}
        onClose={() => setShowEditModal(false)}
      />
    </SafeAreaView>
  );
}
