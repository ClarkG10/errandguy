import React from 'react';
import { View, Text } from 'react-native';
import { Check, X } from 'lucide-react-native';

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

const strengthColors = ['#EF4444', '#EF4444', '#F59E0B', '#F59E0B', '#22C55E', '#22C55E'];
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
              backgroundColor: strength >= level ? strengthColors[strength] : '#E2E8F0',
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
              <Check size={14} color="#22C55E" />
            ) : (
              <X size={14} color="#94A3B8" />
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
