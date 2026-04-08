import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, RefreshControl, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Plus, MapPin, Trash2, Home, Briefcase, Star } from 'lucide-react-native';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { LoadingOverlay } from '../../../components/ui/LoadingOverlay';
import { userService } from '../../../services/user.service';
import type { SavedAddress } from '../../../types';

type AddressLabel = 'home' | 'work' | 'other';

const LABEL_ICONS: Record<string, typeof Home> = {
  home: Home,
  work: Briefcase,
  other: Star,
};

export default function AddressesScreen() {
  const router = useRouter();
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState<AddressLabel>('home');
  const [newAddress, setNewAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchAddresses = useCallback(async () => {
    try {
      const res = await userService.getAddresses();
      setAddresses(res.data.data ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAddresses();
  }, [fetchAddresses]);

  const handleAdd = async () => {
    if (!newAddress.trim()) return;
    setSaving(true);
    try {
      await userService.addAddress({
        label: newLabel,
        address: newAddress.trim(),
        lat: 0,
        lng: 0,
        is_default: false,
        created_at: new Date().toISOString(),
      } as any);
      setNewAddress('');
      setShowAdd(false);
      fetchAddresses();
    } catch {
      Alert.alert('Error', 'Failed to save address');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert('Delete Address', 'Remove this saved address?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await userService.deleteAddress(id);
            setAddresses((prev) => prev.filter((a) => a.id !== id));
          } catch {
            Alert.alert('Error', 'Failed to delete address');
          }
        },
      },
    ]);
  };

  if (loading) return <LoadingOverlay isVisible={true} />;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-5 py-3 border-b border-divider">
        <Pressable onPress={() => router.back()} className="mr-3">
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-lg font-montserrat-bold text-textPrimary flex-1">
          Saved Addresses
        </Text>
        <Pressable onPress={() => setShowAdd(!showAdd)}>
          <Plus size={24} color="#2563EB" />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1 px-5 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Add New Address Form */}
        {showAdd && (
          <Card className="mb-4 p-4">
            <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">New Address</Text>

            {/* Label selector */}
            <View className="flex-row gap-2 mb-3">
              {(['home', 'work', 'other'] as AddressLabel[]).map((label) => (
                <Pressable
                  key={label}
                  onPress={() => setNewLabel(label)}
                  className={`px-3 py-1.5 rounded-full border ${
                    newLabel === label
                      ? 'bg-primary border-primary'
                      : 'border-divider bg-surface'
                  }`}
                >
                  <Text
                    className={`text-xs font-montserrat-bold capitalize ${
                      newLabel === label ? 'text-white' : 'text-textSecondary'
                    }`}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              className="border border-divider rounded-lg px-3 py-2 mb-3 text-sm font-montserrat text-textPrimary"
              placeholder="Enter address"
              placeholderTextColor="#94A3B8"
              value={newAddress}
              onChangeText={setNewAddress}
              multiline
            />

            <Button
              title={saving ? 'Saving...' : 'Save Address'}
              onPress={handleAdd}
              disabled={saving || !newAddress.trim()}
              size="sm"
            />
          </Card>
        )}

        {/* Address List */}
        {addresses.length === 0 ? (
          <View className="items-center py-12">
            <MapPin size={48} color="#94A3B8" />
            <Text className="text-textSecondary font-montserrat mt-3">
              No saved addresses yet
            </Text>
          </View>
        ) : (
          addresses.map((addr) => {
            const Icon = LABEL_ICONS[addr.label] ?? MapPin;
            return (
              <Card key={addr.id} className="mb-3 p-4">
                <View className="flex-row items-start">
                  <View className="w-9 h-9 rounded-full bg-primaryLight items-center justify-center mr-3 mt-0.5">
                    <Icon size={18} color="#2563EB" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-montserrat-bold text-textPrimary capitalize">
                      {addr.label}
                    </Text>
                    <Text className="text-xs font-montserrat text-textSecondary mt-0.5">
                      {addr.address}
                    </Text>
                  </View>
                  <Pressable onPress={() => handleDelete(addr.id)} className="p-1">
                    <Trash2 size={18} color="#EF4444" />
                  </Pressable>
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
