import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Package, Bike } from 'lucide-react-native';
import { Button } from '../../components/ui/Button';
import { Toast } from '../../components/ui/Toast';
import { useAuth } from '../../hooks/useAuth';
import { userService } from '../../services/user.service';
import type { UserRole } from '../../types';

type RoleOption = {
  role: UserRole;
  icon: typeof Package;
  title: string;
  label: string;
  description: string;
  note?: string;
};

const roles: RoleOption[] = [
  {
    role: 'customer',
    icon: Package,
    title: 'I need errands done',
    label: 'Customer',
    description: 'Post tasks, track runners, and get things done.',
  },
  {
    role: 'runner',
    icon: Bike,
    title: 'I want to earn money',
    label: 'Errand Runner',
    description: 'Accept errands, complete them, and earn on your own time.',
    note: 'Verification required',
  },
];

export default function RoleSelectScreen() {
  const router = useRouter();
  const { updateProfile } = useAuth();
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', variant: 'error' as const });

  const handleContinue = async () => {
    if (!selectedRole) return;

    setLoading(true);
    try {
      await userService.updateProfile({ role: selectedRole } as any);
      updateProfile({ role: selectedRole });

      if (selectedRole === 'runner') {
        router.replace('/(runner)/(tabs)');
      } else {
        router.replace('/(customer)/(tabs)');
      }
    } catch (error: any) {
      const message =
        error?.response?.data?.message || 'Something went wrong. Please try again.';
      setToast({ visible: true, message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface px-6">
      <Toast
        message={toast.message}
        variant={toast.variant}
        visible={toast.visible}
        onDismiss={() => setToast((prev) => ({ ...prev, visible: false }))}
      />

      <View className="flex-1 justify-center">
        <Text className="text-2xl font-montserrat-bold text-textPrimary mb-1">
          How will you use ErrandGuy?
        </Text>
        <Text className="text-base font-montserrat text-textSecondary mb-8">
          You can always switch later.
        </Text>

        {roles.map((item) => {
          const Icon = item.icon;
          const isSelected = selectedRole === item.role;

          return (
            <Pressable
              key={item.role}
              className={`border rounded-[14px] p-5 mb-4 ${
                isSelected
                  ? 'border-primary border-2 bg-primaryLight'
                  : 'border-divider bg-surface'
              }`}
              onPress={() => setSelectedRole(item.role)}
            >
              <View className="flex-row items-center mb-2">
                <View className="w-12 h-12 rounded-full bg-primaryLight items-center justify-center mr-3">
                  <Icon size={24} color="#2563EB" />
                </View>
                <View className="flex-1">
                  <Text className="text-lg font-montserrat-bold text-textPrimary">
                    {item.title}
                  </Text>
                  <Text className="text-sm font-montserrat text-primary">
                    {item.label}
                  </Text>
                </View>
              </View>
              <Text className="text-sm font-montserrat text-textSecondary">
                {item.description}
              </Text>
              {item.note && (
                <Text className="text-xs font-montserrat text-primary mt-1">
                  {item.note}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>

      <View className="pb-6">
        <Button
          title="Continue"
          fullWidth
          size="lg"
          loading={loading}
          disabled={!selectedRole}
          onPress={handleContinue}
        />
      </View>
    </SafeAreaView>
  );
}
