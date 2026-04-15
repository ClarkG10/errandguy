import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Package, Bike, Check } from 'lucide-react-native';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../hooks/useAuth';
import { userService } from '../../services/user.service';
import { toast } from '../../stores/toastStore';
import type { UserRole } from '../../types';

type RoleOption = {
  role: UserRole;
  icon: typeof Package;
  title: string;
  subtitle: string;
  features: string[];
};

const roles: RoleOption[] = [
  {
    role: 'customer',
    icon: Package,
    title: 'Customer',
    subtitle: 'I need errands done',
    features: ['Post any errand', 'Track runners live', 'Secure payments'],
  },
  {
    role: 'runner',
    icon: Bike,
    title: 'Errand Runner',
    subtitle: 'I want to earn money',
    features: ['Accept errands nearby', 'Earn on your schedule', 'Instant payouts'],
  },
];

export default function RoleSelectScreen() {
  const router = useRouter();
  const { updateProfile } = useAuth();
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    if (!selectedRole) return;

    setLoading(true);
    try {
      await userService.updateProfile({ role: selectedRole });
      updateProfile({ role: selectedRole });

      if (selectedRole === 'runner') {
        router.replace('/(runner)/onboarding');
      } else {
        router.replace('/(customer)/(tabs)');
      }
    } catch (error: any) {
      const message =
        error?.message || 'Something went wrong. Please try again.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface px-6">
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text className="text-[28px] font-montserrat-bold text-textPrimary mb-2 text-center tracking-tight">
          How will you use{'\n'}ErrandGuy?
        </Text>
        <Text className="text-[15px] font-montserrat text-textTertiary text-center mb-10">
          Choose your role. You can switch anytime.
        </Text>

        <View style={{ gap: 14 }}>
          {roles.map((item) => {
            const Icon = item.icon;
            const isSelected = selectedRole === item.role;

            return (
              <Pressable
                key={item.role}
                style={[s.card, isSelected && s.cardSelected]}
                onPress={() => setSelectedRole(item.role)}
              >
                {/* Selected indicator */}
                <View style={[s.radio, isSelected && s.radioSelected]}>
                  {isSelected && <Check size={14} color="#fff" strokeWidth={3} />}
                </View>

                <View style={s.cardHeader}>
                  <Icon size={28} color={isSelected ? '#2563EB' : '#64748B'} />
                  <View style={{ flex: 1 }}>
                    <Text className="text-[18px] font-montserrat-semi text-textPrimary">
                      {item.title}
                    </Text>
                    <Text className="text-[13px] font-montserrat text-textTertiary mt-0.5">
                      {item.subtitle}
                    </Text>
                  </View>
                </View>

                <View style={s.features}>
                  {item.features.map((f) => (
                    <View key={f} style={s.featureRow}>
                      <View style={[s.featureDot, isSelected && s.featureDotSelected]} />
                      <Text className="text-[13px] font-montserrat text-textSecondary">
                        {f}
                      </Text>
                    </View>
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ paddingBottom: 24 }}>
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

const s = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    backgroundColor: '#FAFBFC',
    position: 'relative',
  },
  cardSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  radio: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#2563EB',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  features: {
    gap: 8,
    paddingLeft: 42,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#CBD5E1',
  },
  featureDotSelected: {
    backgroundColor: '#2563EB',
  },
});
