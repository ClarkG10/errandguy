import React from 'react';
import { View, TextInput, Pressable } from 'react-native';
import { Search, X } from 'lucide-react-native';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search...',
}: SearchBarProps) {
  return (
    <View className="flex-row items-center bg-surface border border-divider rounded-lg px-4 h-12">
      <Search size={20} color="#94A3B8" />
      <TextInput
        className="flex-1 ml-3 text-sm font-montserrat text-textPrimary"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        returnKeyType="search"
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChangeText('')}>
          <X size={18} color="#94A3B8" />
        </Pressable>
      )}
    </View>
  );
}
