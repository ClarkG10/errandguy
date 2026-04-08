import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { MapPin, Star, X } from 'lucide-react-native';
import { BottomSheet } from '../ui/BottomSheet';
import { userService } from '../../services/user.service';
import type { SavedAddress } from '../../types';

interface SavedAddressSheetProps {
  isVisible: boolean;
  onClose: () => void;
  onSelect: (address: SavedAddress) => void;
}

export function SavedAddressSheet({
  isVisible,
  onClose,
  onSelect,
}: SavedAddressSheetProps) {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isVisible) {
      setLoading(true);
      userService
        .getAddresses()
        .then((res) => setAddresses(res.data.data ?? []))
        .catch(() => setAddresses([]))
        .finally(() => setLoading(false));
    }
  }, [isVisible]);

  return (
    <BottomSheet isVisible={isVisible} onClose={onClose} snapPoints={[0.5]}>
      <View className="px-5 pb-6">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-lg font-montserrat-bold text-textPrimary">
            Saved Addresses
          </Text>
          <Pressable onPress={onClose}>
            <X size={24} color="#475569" />
          </Pressable>
        </View>

        {loading ? (
          <View className="items-center py-8">
            <ActivityIndicator color="#2563EB" />
          </View>
        ) : addresses.length === 0 ? (
          <View className="items-center py-8">
            <MapPin size={40} color="#94A3B8" />
            <Text className="text-sm font-montserrat text-textSecondary mt-2">
              No saved addresses
            </Text>
          </View>
        ) : (
          <FlatList
            data={addresses}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                className="flex-row items-center border-b border-divider py-3"
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
              >
                <View className="w-8 h-8 rounded-lg bg-primaryLight items-center justify-center mr-3">
                  {item.is_default ? (
                    <Star size={16} color="#2563EB" fill="#2563EB" />
                  ) : (
                    <MapPin size={16} color="#2563EB" />
                  )}
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-montserrat-bold text-textPrimary">
                    {item.label}
                  </Text>
                  <Text
                    className="text-xs font-montserrat text-textSecondary mt-0.5"
                    numberOfLines={1}
                  >
                    {item.address}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        )}
      </View>
    </BottomSheet>
  );
}
