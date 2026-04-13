import React from 'react';
import { View, Text } from 'react-native';
import { Button } from './Button';
import type { LucideIcon } from 'lucide-react-native';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center px-8 py-12">
      <View className="w-16 h-16 rounded-2xl bg-primary50 items-center justify-center mb-2">
        <Icon size={28} color="#2563EB" />
      </View>
      <Text className="text-lg font-montserrat-bold text-textPrimary mt-2 text-center">
        {title}
      </Text>
      {description && (
        <Text className="text-sm font-montserrat text-textTertiary mt-2 text-center">
          {description}
        </Text>
      )}
      {actionLabel && onAction && (
        <View className="mt-6">
          <Button title={actionLabel} onPress={onAction} variant="primary" />
        </View>
      )}
    </View>
  );
}
