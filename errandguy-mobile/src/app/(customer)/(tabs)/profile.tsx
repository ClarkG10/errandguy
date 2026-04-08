import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
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

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete Account',
      'This action is permanent and cannot be undone. All your data will be removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            try {
              await userService.deleteAccount();
              await logout();
              router.replace('/(auth)/welcome');
            } catch {
              Alert.alert('Error', 'Failed to delete account');
            }
          },
        },
      ],
    );
  }, [logout, router]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <View className="items-center pt-6 pb-4">
          <Avatar
            uri={user?.avatar_url}
            name={user?.full_name}
            size="xl"
          />
          <Text className="text-xl font-montserrat-bold text-textPrimary mt-3">
            {user?.full_name}
          </Text>
          {user?.email && (
            <Text className="text-sm font-montserrat text-textSecondary mt-0.5">
              {user.email}
            </Text>
          )}
          {user?.phone && (
            <Text className="text-sm font-montserrat text-textSecondary mt-0.5">
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
          <Text className="text-xs font-montserrat-bold text-textSecondary uppercase mb-2">
            Account
          </Text>
          <Card>
            <ProfileMenuItem
              icon={User}
              label="Edit Profile"
              onPress={() => setShowEditModal(true)}
            />
            <View className="h-px bg-divider" />
            <ProfileMenuItem
              icon={MapPin}
              label="Saved Addresses"
              onPress={() => router.push('/(customer)/addresses' as any)}
            />
            <View className="h-px bg-divider" />
            <ProfileMenuItem
              icon={Users}
              label="Trusted Contacts"
              onPress={() => router.push('/(customer)/trusted-contacts' as any)}
            />
          </Card>
        </View>

        {/* Payment Section */}
        <View className="px-5 mb-4">
          <Text className="text-xs font-montserrat-bold text-textSecondary uppercase mb-2">
            Payment
          </Text>
          <Card>
            <ProfileMenuItem
              icon={CreditCard}
              label="Payment Methods"
              onPress={() => router.push('/(customer)/wallet' as any)}
            />
            <View className="h-px bg-divider" />
            <ProfileMenuItem
              icon={Wallet}
              label={`Wallet (${formatCurrency(user?.wallet_balance ?? 0)})`}
              onPress={() => router.push('/(customer)/wallet' as any)}
            />
          </Card>
        </View>

        {/* Support Section */}
        <View className="px-5 mb-4">
          <Text className="text-xs font-montserrat-bold text-textSecondary uppercase mb-2">
            Support
          </Text>
          <Card>
            <ProfileMenuItem
              icon={HelpCircle}
              label="Help Center"
              onPress={() => {}}
            />
            <View className="h-px bg-divider" />
            <ProfileMenuItem
              icon={AlertTriangle}
              label="Report an Issue"
              onPress={() => {}}
            />
          </Card>
        </View>

        {/* Account Actions */}
        <View className="px-5 mb-8">
          <Text className="text-xs font-montserrat-bold text-textSecondary uppercase mb-2">
            Account Actions
          </Text>
          <Card>
            <ProfileMenuItem
              icon={LogOut}
              label="Logout"
              danger
              onPress={handleLogout}
            />
            <View className="h-px bg-divider" />
            <ProfileMenuItem
              icon={Trash2}
              label="Delete Account"
              danger
              onPress={handleDeleteAccount}
            />
          </Card>
        </View>
      </ScrollView>

      <EditProfileModal
        visible={showEditModal}
        onClose={() => setShowEditModal(false)}
      />
    </SafeAreaView>
  );
}
