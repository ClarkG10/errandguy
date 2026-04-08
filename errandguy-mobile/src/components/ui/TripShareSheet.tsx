import React from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { Check, Share2 } from 'lucide-react-native';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import type { TrustedContact } from '../../types';

interface TripShareSheetProps {
  isVisible: boolean;
  onClose: () => void;
  bookingId: string;
  trustedContacts: TrustedContact[];
  selectedIds?: string[];
  onToggleContact?: (id: string) => void;
  onShareExternal?: () => void;
}

export function TripShareSheet({
  isVisible,
  onClose,
  trustedContacts,
  selectedIds = [],
  onToggleContact,
  onShareExternal,
}: TripShareSheetProps) {
  return (
    <BottomSheet isVisible={isVisible} onClose={onClose} snapPoints={[0.6]}>
      <Text className="text-lg font-montserrat-bold text-textPrimary mb-4">
        Share Trip
      </Text>

      <Text className="text-sm font-montserrat text-textSecondary mb-3">
        Trusted Contacts
      </Text>

      <FlatList
        data={trustedContacts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const isSelected = selectedIds.includes(item.id);
          return (
            <Pressable
              className="flex-row items-center py-3 border-b border-divider"
              onPress={() => onToggleContact?.(item.id)}
            >
              <View
                className={`w-6 h-6 rounded-md border items-center justify-center mr-3 ${
                  isSelected ? 'bg-primary border-primary' : 'border-divider'
                }`}
              >
                {isSelected && <Check size={16} color="#fff" />}
              </View>
              <View className="flex-1">
                <Text className="text-sm font-montserrat-bold text-textPrimary">
                  {item.name}
                </Text>
                <Text className="text-xs font-montserrat text-textSecondary">
                  {item.phone}
                </Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text className="text-sm font-montserrat text-textSecondary text-center py-4">
            No trusted contacts added yet
          </Text>
        }
      />

      <View className="mt-4 gap-3">
        <Button
          title="Share via App"
          icon={Share2}
          variant="outline"
          onPress={onShareExternal}
          fullWidth
        />
      </View>
    </BottomSheet>
  );
}
