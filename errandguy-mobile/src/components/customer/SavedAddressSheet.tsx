import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { MapPin, Star, X, Plus } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { BottomSheet } from '../ui/BottomSheet';
import { userService } from '../../services/user.service';
import { useQuery } from '../../hooks/useQuery';
import { CacheTTL } from '../../services/cache.service';
import { useAuthStore } from '../../stores/authStore';
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
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');

  // Cache-first fetch — repeat opens of the sheet paint immediately from
  // AsyncStorage, then revalidate in the background. Previously every
  // open hit the network with a spinner. Disabled until the sheet is
  // first shown so we don't fetch on screens that never open it.
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => {
    if (isVisible) setHasOpened(true);
  }, [isVisible]);

  const addressesQ = useQuery<SavedAddress[]>(
    ['user', 'addresses', userId],
    async () => ((await userService.getAddresses()).data.data ?? []) as SavedAddress[],
    { staleTime: 60_000, ttl: CacheTTL.LONG, enabled: hasOpened },
  );

  const addresses = addressesQ.data ?? [];
  const loading = addressesQ.loading && !addressesQ.data;

  // Default first, then by label so the most-used address is one tap away.
  const orderedAddresses = useMemo(
    () =>
      [...addresses].sort((a, b) => {
        if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
        return (a.label ?? '').localeCompare(b.label ?? '');
      }),
    [addresses],
  );

  const handleAddNew = () => {
    onClose();
    // Defer navigation a tick so the sheet's close animation can run
    // before the new screen mounts — feels less jarring than a hard cut.
    setTimeout(() => router.push('/(customer)/addresses' as any), 120);
  };

  return (
    <BottomSheet isVisible={isVisible} onClose={onClose} snapPoints={[0.55]}>
      <View className="px-5 pb-6">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-lg font-montserrat-semi text-textPrimary">
            Saved addresses
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close saved addresses"
            hitSlop={8}
          >
            <X size={24} color="#475569" />
          </Pressable>
        </View>

        {loading ? (
          <View className="items-center py-8">
            <ActivityIndicator color="#2563EB" />
          </View>
        ) : addresses.length === 0 ? (
          <View className="items-center py-8">
            <View className="w-14 h-14 rounded-full bg-primary50 items-center justify-center mb-3">
              <MapPin size={26} color="#2563EB" />
            </View>
            <Text className="text-sm font-montserrat-semi text-textPrimary">
              No saved addresses yet
            </Text>
            <Text className="text-xs font-montserrat text-textSecondary mt-1 text-center px-4">
              Save your home, office, or any place you visit often for one-tap booking.
            </Text>
            <Pressable
              onPress={handleAddNew}
              accessibilityRole="button"
              className="mt-4 flex-row items-center gap-2 bg-primary rounded-xl px-4 py-2.5"
            >
              <Plus size={16} color="#FFFFFF" />
              <Text className="text-sm font-montserrat-semi text-white">
                Add an address
              </Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={orderedAddresses}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                android_ripple={{ color: '#E2E8F0', borderless: false }}
                className="flex-row items-center border-b border-divider py-3"
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Use ${item.label}${item.is_default ? ', default' : ''}`}
              >
                <View
                  className={`w-9 h-9 rounded-xl items-center justify-center mr-3 ${
                    item.is_default ? 'bg-primary' : 'bg-primaryLight'
                  }`}
                >
                  {item.is_default ? (
                    <Star size={16} color="#FFFFFF" fill="#FFFFFF" />
                  ) : (
                    <MapPin size={16} color="#2563EB" />
                  )}
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center">
                    <Text className="text-sm font-montserrat-semi text-textPrimary">
                      {item.label}
                    </Text>
                    {item.is_default && (
                      <View className="ml-2 bg-primary50 rounded-full px-2 py-0.5">
                        <Text className="text-[9px] font-montserrat-bold text-primary uppercase tracking-wider">
                          Default
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text
                    className="text-xs font-montserrat text-textSecondary mt-0.5"
                    numberOfLines={1}
                  >
                    {item.address}
                  </Text>
                </View>
              </Pressable>
            )}
            ListFooterComponent={
              <Pressable
                onPress={handleAddNew}
                accessibilityRole="button"
                accessibilityLabel="Manage saved addresses"
                className="flex-row items-center justify-center gap-2 mt-3 py-3 rounded-xl bg-primary50"
              >
                <Plus size={16} color="#2563EB" />
                <Text className="text-sm font-montserrat-semi text-primary">
                  Manage addresses
                </Text>
              </Pressable>
            }
          />
        )}
      </View>
    </BottomSheet>
  );
}
