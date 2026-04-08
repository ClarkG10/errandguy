import React from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { Star, Edit2, Trash2, Plus, GripVertical } from 'lucide-react-native';
import type { TrustedContact } from '../../types';

interface TrustedContactsListProps {
  contacts: TrustedContact[];
  onReorder?: (contacts: TrustedContact[]) => void;
  onAdd?: () => void;
  onEdit?: (contact: TrustedContact) => void;
  onDelete?: (id: string) => void;
  onSetPrimary?: (id: string) => void;
}

export function TrustedContactsList({
  contacts,
  onAdd,
  onEdit,
  onDelete,
  onSetPrimary,
}: TrustedContactsListProps) {
  return (
    <View>
      <FlatList
        data={contacts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View className="flex-row items-center py-3 border-b border-divider">
            <View className="mr-2">
              <GripVertical size={18} color="#94A3B8" />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-montserrat-bold text-textPrimary">
                {item.name}
              </Text>
              <Text className="text-xs font-montserrat text-textSecondary">
                {item.phone} • {item.relationship}
              </Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Pressable onPress={() => onSetPrimary?.(item.id)}>
                <Star
                  size={18}
                  color={item.priority === 1 ? '#F59E0B' : '#94A3B8'}
                  fill={item.priority === 1 ? '#F59E0B' : 'transparent'}
                />
              </Pressable>
              <Pressable onPress={() => onEdit?.(item)}>
                <Edit2 size={18} color="#475569" />
              </Pressable>
              <Pressable onPress={() => onDelete?.(item.id)}>
                <Trash2 size={18} color="#EF4444" />
              </Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <Text className="text-sm font-montserrat text-textSecondary text-center py-6">
            No trusted contacts yet
          </Text>
        }
      />
      {onAdd && (
        <Pressable
          className="flex-row items-center justify-center py-3 mt-2"
          onPress={onAdd}
        >
          <Plus size={18} color="#2563EB" />
          <Text className="text-sm font-montserrat-bold text-primary ml-2">
            Add Contact
          </Text>
        </Pressable>
      )}
    </View>
  );
}
