import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { Package, Bike, Check } from 'lucide-react-native';
import { Button } from '../../components/ui/Button';
import { Illustration } from '../../components/ui/Illustration';
import { useAuth } from '../../hooks/useAuth';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { userService } from '../../services/user.service';
import { toast } from '../../stores/toastStore';
import { LightColors } from '../../constants/colors';
import { useResponsive } from '../../constants/responsive';
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
  const { contentMaxWidth } = useResponsive();
  const reduceMotion = useReducedMotion();
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    if (!selectedRole) return;

    setLoading(true);
    try {
      await userService.updateProfile({ role: selectedRole });
      updateProfile({ role: selectedRole });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      if (selectedRole === 'runner') {
        router.replace('/(runner)/onboarding');
      } else {
        router.replace('/(customer)/(tabs)');
      }
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const message =
        error?.message || 'Something went wrong. Please try again.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background px-6">
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingBottom: 16,
          width: '100%',
          maxWidth: contentMaxWidth,
          alignSelf: 'center',
        }}
      >
        <Illustration
          name="role-select"
          size={200}
          style={{ alignSelf: 'center', marginBottom: 4 }}
        />
        <Text
          className="text-[11px] font-montserrat-bold uppercase text-primary mb-3 text-center"
          style={{ letterSpacing: 1.8 }}
        >
          One last step
        </Text>
        <Text
          className="text-[28px] font-montserrat-bold text-ink text-center"
          style={{ letterSpacing: -0.4, lineHeight: 32 }}
          accessibilityRole="header"
        >
          How will you use{'\n'}ErrandGuy?
        </Text>
        <Text className="text-[15px] font-montserrat text-textSecondary text-center mt-2 mb-10">
          Choose your role. You can switch anytime.
        </Text>

        <View
          style={{ gap: 14 }}
          accessibilityRole="radiogroup"
          accessibilityLabel="Choose your role"
        >
          {roles.map((item) => {
            const Icon = item.icon;
            const isSelected = selectedRole === item.role;

            return (
              <Pressable
                key={item.role}
                style={({ pressed }) => [
                  s.card,
                  isSelected && s.cardSelected,
                  // Scale-only when selected so the primaryLight tint isn't lost.
                  pressed && !isSelected && s.cardPressedBg,
                  pressed && s.cardPressed,
                ]}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setSelectedRole(item.role);
                }}
                accessibilityRole="radio"
                accessibilityLabel={`${item.title}. ${item.subtitle}`}
                accessibilityState={{ selected: isSelected, checked: isSelected }}
              >
                {/* Selected indicator */}
                <View style={[s.radio, isSelected && s.radioSelected]}>
                  {isSelected &&
                    (reduceMotion ? (
                      <Check size={14} color={LightColors.textInverse} strokeWidth={3} />
                    ) : (
                      // Mounts only on selection (selectedRole starts null),
                      // so this never plays on first render of the screen.
                      <MotiView
                        from={{ scale: 0.4, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', damping: 14, stiffness: 260 }}
                      >
                        <Check size={14} color={LightColors.textInverse} strokeWidth={3} />
                      </MotiView>
                    ))}
                </View>

                <View style={s.cardHeader}>
                  {/* Icon chip — primaryLight circle with a primary icon. */}
                  <View style={[s.iconChip, isSelected && s.iconChipSelected]}>
                    <Icon
                      size={22}
                      color={isSelected ? LightColors.primary : LightColors.textTertiary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text className="text-[18px] font-montserrat-semi text-textPrimary">
                      {item.title}
                    </Text>
                    {/* textSecondary (not tertiary): keeps AA contrast on the
                        selected card's primaryLight background at 13px. */}
                    <Text className="text-[13px] font-montserrat text-textSecondary mt-0.5">
                      {item.subtitle}
                    </Text>
                  </View>
                </View>

                <View style={s.features}>
                  {item.features.map((f) => (
                    <View key={f} style={s.featureRow}>
                      <Check
                        size={13}
                        color={LightColors.primary}
                        strokeWidth={2.5}
                      />
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
      </ScrollView>

      <View
        style={{
          paddingBottom: 24,
          width: '100%',
          maxWidth: contentMaxWidth,
          alignSelf: 'center',
        }}
      >
        <Button
          title="Continue"
          fullWidth
          size="lg"
          loading={loading}
          loadingTitle="Setting up…"
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
    borderColor: LightColors.divider,
    backgroundColor: LightColors.surface,
    position: 'relative',
  },
  cardSelected: {
    borderColor: LightColors.primary,
    backgroundColor: LightColors.primaryLight,
  },
  // Scale-only transform keeps layout bounds stable while pressed.
  cardPressed: {
    transform: [{ scale: 0.985 }],
  },
  cardPressedBg: {
    backgroundColor: LightColors.surfaceMuted,
  },
  radio: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    // textMuted, not dividerStrong: the unselected ring must read as an
    // affordance (dividerStrong is 1.48:1 on white — nearly invisible).
    borderColor: LightColors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: LightColors.primary,
    backgroundColor: LightColors.primary,
  },
  iconChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LightColors.surfaceMuted,
  },
  iconChipSelected: {
    backgroundColor: LightColors.primarySoft,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  features: {
    gap: 8,
    paddingLeft: 58,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
