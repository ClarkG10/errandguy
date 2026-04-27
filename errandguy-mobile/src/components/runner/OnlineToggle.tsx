import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { toast } from '../../stores/toastStore';

interface OnlineToggleProps {
  isOnline: boolean;
  onToggle: (value: boolean) => void;
  disabled?: boolean;
}

export function OnlineToggle({ isOnline, onToggle, disabled }: OnlineToggleProps) {
  const handlePress = () => {
    if (disabled) {
      toast.warning(
        'Your account needs verification before you can go online. Submit your documents for review.',
      );
      return;
    }
    onToggle(!isOnline);
  };

  return (
    <Pressable
      onPress={handlePress}
      className={`flex-row items-center justify-between px-5 py-4 rounded-2xl border ${
        isOnline
          ? 'bg-green-50 border-green-300'
          : disabled
          ? 'bg-surface border-divider opacity-60'
          : 'bg-surface border-divider'
      }`}
    >
      <View className="flex-row items-center gap-3">
        <View
          className={`w-4 h-4 rounded-full ${
            isOnline ? 'bg-success' : 'bg-gray-300'
          }`}
        />
        <View>
          <Text className="text-base font-montserrat-bold text-textPrimary">
            {isOnline ? "You're Online" : "You're Offline"}
          </Text>
          <Text className="text-xs font-montserrat text-textSecondary">
            {isOnline
              ? 'Receiving errand requests'
              : disabled
              ? 'Complete verification to go online'
              : 'Tap to start accepting errands'}
          </Text>
        </View>
      </View>
      <View
        className={`w-14 h-8 rounded-full justify-center px-1 ${
          isOnline ? 'bg-success items-end' : 'bg-gray-300 items-start'
        }`}
      >
        <View className="w-6 h-6 rounded-full bg-white" />
      </View>
    </Pressable>
  );
}
