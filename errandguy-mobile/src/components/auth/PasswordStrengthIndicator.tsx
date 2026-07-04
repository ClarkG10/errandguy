import React from 'react';
import { View, Text } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';

interface PasswordStrengthIndicatorProps {
  password: string;
}

const requirements = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'Uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: 'Number', test: (p: string) => /\d/.test(p) },
  { label: 'Special character', test: (p: string) => /[!@#$%^&*(),.?":{}|<>]/.test(p) },
];

function getStrength(password: string): number {
  if (!password) return 0;
  return requirements.filter((r) => r.test(password)).length;
}

const strengthColors = [
  LightColors.danger,
  LightColors.danger,
  LightColors.warning,
  LightColors.warning,
  LightColors.success,
  LightColors.success,
];
const strengthLabels = ['', 'Weak', 'Weak', 'Fair', 'Good', 'Strong'];

export function PasswordStrengthIndicator({ password }: PasswordStrengthIndicatorProps) {
  const strength = getStrength(password);

  if (!password) return null;

  return (
    <View className="mt-1 mb-2">
      <View className="flex-row gap-1.5 mb-2">
        {[1, 2, 3, 4].map((level) => (
          <View
            key={level}
            className="flex-1 h-1 rounded-full"
            style={{
              backgroundColor:
                strength >= level ? strengthColors[strength] : LightColors.divider,
            }}
          />
        ))}
      </View>
      <Text
        className="text-xs font-montserrat mb-2"
        style={{ color: strengthColors[strength] }}
      >
        {strengthLabels[strength]}
      </Text>
      {requirements.map((req) => {
        const passed = req.test(password);
        return (
          <View key={req.label} className="flex-row items-center mb-1">
            {passed ? (
              <Check size={14} color={LightColors.success} />
            ) : (
              <X size={14} color={LightColors.textMuted} />
            )}
            <Text
              className={`text-xs font-montserrat ml-1.5 ${passed ? 'text-success' : 'text-textSecondary'}`}
            >
              {req.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
