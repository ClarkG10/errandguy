import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, TextInput, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, Plus, MapPin, Trash2, Pencil, Home, Briefcase, Star, X, Search } from 'lucide-react-native';
import Mapbox from '@rnmapbox/maps';
import { Button } from '../../../components/ui/Button';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { Skeleton } from '../../../components/ui/Skeleton';
import { useDebounce } from '../../../hooks/useDebounce';
import { useQuery } from '../../../hooks/useQuery';
import { useAuthStore } from '../../../stores/authStore';
import { CacheTTL } from '../../../services/cache.service';
import { userService } from '../../../services/user.service';
import { MAP_STYLE_URL } from '../../../constants/map';
import type { SavedAddress } from '../../../types';
import { toast } from '../../../stores/toastStore';

type AddressLabel = 'home' | 'work' | 'other';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';
const DEFAULT_CENTER: [number, number] = [121.0, 14.6];

const LABEL_ICONS: Record<string, typeof Home> = {
  home: Home,
  work: Briefcase,
  other: Star,
};

function AddressSkeleton() {
  return (
    <View className="flex-1 bg-background px-4 pt-4">
      {[1, 2, 3].map((i) => (
        <View key={i} className="flex-row items-center bg-surface rounded-xl p-3 mb-2">
          <Skeleton width={36} height={36} borderRadius={18} />
          <View className="flex-1 ml-3">
            <Skeleton width={80} height={14} borderRadius={4} />
            <Skeleton width="90%" height={12} borderRadius={4} style={{ marginTop: 6 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function AddressesScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const addressesQ = useQuery<SavedAddress[]>(
    ['user', 'addresses', userId],
    async () => {
      const r = await userService.getAddresses();
      return (r.data.data ?? []) as SavedAddress[];
    },
    { staleTime: 60_000, ttl: CacheTTL.LONG },
  );
  const addresses = addressesQ.data ?? [];
  const loading = addressesQ.loading && !addressesQ.data;
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingAddress, setDeletingAddress] = useState(false);
  const [newLabel, setNewLabel] = useState<AddressLabel>('home');
  const [customLabel, setCustomLabel] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newLat, setNewLat] = useState(0);
  const [newLng, setNewLng] = useState(0);
  const [saving, setSaving] = useState(false);

  // Map search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ place_name: string; center: [number, number] }>>([]);
  const debouncedSearch = useDebounce(searchQuery, 400);
  const cameraRef = useRef<Mapbox.Camera>(null);
  const geocodeTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchAddresses = useCallback(async () => {
    await addressesQ.refresh();
  }, [addressesQ]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await addressesQ.refresh();
    setRefreshing(false);
  }, [addressesQ]);

  /* ── Reverse geocode ── */
  const reverseGeocode = useCallback(async (lng: number, lat: number): Promise<string> => {
    if (!MAPBOX_TOKEN) return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&language=en&limit=1`,
      );
      const data = await res.json();
      return data.features?.[0]?.place_name ?? `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    } catch {
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
  }, []);

  /* ── Search geocoding ── */
  useEffect(() => {
    if (debouncedSearch.length < 3 || !MAPBOX_TOKEN) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const encoded = encodeURIComponent(debouncedSearch);
    fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&country=ph&limit=5&language=en`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setSearchResults(
          (data.features ?? []).map((f: any) => ({
            place_name: f.place_name,
            center: f.center,
          })),
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [debouncedSearch]);

  const handleSearchSelect = useCallback((item: { place_name: string; center: [number, number] }) => {
    setSearchQuery('');
    setSearchResults([]);
    Keyboard.dismiss();
    setNewAddress(item.place_name);
    setNewLng(item.center[0]);
    setNewLat(item.center[1]);
    cameraRef.current?.setCamera({
      centerCoordinate: item.center,
      zoomLevel: 16,
      animationDuration: 800,
    });
  }, []);

  const handleMapRegionDidChange = useCallback((feature: any) => {
    const center = feature?.geometry?.coordinates as [number, number] | undefined;
    if (!center) return;
    if (geocodeTimeout.current) clearTimeout(geocodeTimeout.current);
    geocodeTimeout.current = setTimeout(async () => {
      setNewLng(center[0]);
      setNewLat(center[1]);
      const addr = await reverseGeocode(center[0], center[1]);
      setNewAddress(addr);
    }, 300);
  }, [reverseGeocode]);

  const handleAdd = async () => {
    if (!newAddress.trim()) return;
    const finalLabel = newLabel === 'other' && customLabel.trim() ? customLabel.trim() : newLabel;
    setSaving(true);
    try {
      if (editingId) {
        await userService.updateAddress(editingId, {
          label: finalLabel,
          address: newAddress.trim(),
          lat: newLat,
          lng: newLng,
        });
      } else {
        await userService.addAddress({
          label: finalLabel,
          address: newAddress.trim(),
          lat: newLat,
          lng: newLng,
          is_default: false,
          created_at: new Date().toISOString(),
        } as any);
      }
      setNewAddress('');
      setCustomLabel('');
      setShowAdd(false);
      setEditingId(null);
      fetchAddresses();
    } catch {
      toast.error('Failed to save address');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (addr: SavedAddress) => {
    setEditingId(addr.id);
    const standardLabels: AddressLabel[] = ['home', 'work', 'other'];
    if (standardLabels.includes(addr.label as AddressLabel)) {
      setNewLabel(addr.label as AddressLabel);
      setCustomLabel('');
    } else {
      setNewLabel('other');
      setCustomLabel(addr.label);
    }
    setNewAddress(addr.address);
    setNewLat(addr.lat ?? 0);
    setNewLng(addr.lng ?? 0);
    setShowAdd(true);
  };

  const handleDelete = (id: string) => {
    setPendingDeleteId(id);
  };

  const confirmDeleteAddress = async () => {
    if (!pendingDeleteId) return;
    setDeletingAddress(true);
    try {
      await userService.deleteAddress(pendingDeleteId);
      // Refresh from source so the cached query stays consistent across
      // screens (the previous local setState lost on the next refetch).
      await addressesQ.refresh();
      setPendingDeleteId(null);
    } catch {
      toast.error('Failed to delete address');
    } finally {
      setDeletingAddress(false);
    }
  };

  const resetForm = () => {
    setShowAdd(!showAdd);
    setEditingId(null);
    setNewAddress('');
    setNewLabel('home');
    setCustomLabel('');
    setSearchQuery('');
    setSearchResults([]);
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3">
        <Pressable
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(customer)/(tabs)/profile');
            }
          }}
          className="mr-3 w-9 h-9 rounded-xl bg-surface items-center justify-center"
        >
          <ChevronLeft size={20} color="#0F172A" />
        </Pressable>
        <Text className="text-base font-montserrat-semi text-textPrimary flex-1">
          Saved Addresses
        </Text>
        <Pressable
          onPress={resetForm}
          className="w-9 h-9 rounded-xl bg-primary50 items-center justify-center"
        >
          {showAdd ? <X size={18} color="#2563EB" /> : <Plus size={18} color="#2563EB" />}
        </Pressable>
      </View>

      {loading ? (
        <AddressSkeleton />
      ) : (
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 100 }}
        >
          {/* Add / Edit Form with Map */}
          {showAdd && (
            <View className="mb-4 rounded-2xl bg-surface overflow-hidden border border-divider">
              {/* Map Picker */}
              <View style={{ height: 180 }}>
                <Mapbox.MapView
                  style={{ flex: 1 }}
                  styleURL={MAP_STYLE_URL}
                  onRegionDidChange={handleMapRegionDidChange}
                  attributionEnabled={false}
                  logoEnabled={false}
                  scaleBarEnabled={false}
                >
                  <Mapbox.Camera
                    ref={cameraRef}
                    defaultSettings={{
                      centerCoordinate: newLat && newLng ? [newLng, newLat] : DEFAULT_CENTER,
                      zoomLevel: 14,
                    }}
                  />
                </Mapbox.MapView>
                {/* Center pin */}
                <View
                  style={{ position: 'absolute', top: '50%', left: '50%', marginLeft: -12, marginTop: -24 }}
                  pointerEvents="none"
                >
                  <MapPin size={24} color="#2563EB" fill="#2563EB" />
                </View>

                {/* Search overlay */}
                <View style={{ position: 'absolute', top: 8, left: 8, right: 8 }}>
                  <View
                    className="flex-row items-center bg-white/95 rounded-lg px-2.5 py-1.5"
                    style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 }}
                  >
                    <Search size={14} color="#94A3B8" />
                    <TextInput
                      className="flex-1 text-xs font-montserrat text-textPrimary ml-2 py-0"
                      placeholder="Search location..."
                      placeholderTextColor="#94A3B8"
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                    />
                    {searchQuery.length > 0 && (
                      <Pressable onPress={() => { setSearchQuery(''); setSearchResults([]); }}>
                        <X size={14} color="#94A3B8" />
                      </Pressable>
                    )}
                  </View>
                  {searchResults.length > 0 && (
                    <View
                      className="bg-white rounded-lg mt-1 overflow-hidden"
                      style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 }}
                    >
                      {searchResults.map((item, i) => (
                        <Pressable
                          key={i}
                          className="px-3 py-2 border-b border-divider"
                          onPress={() => handleSearchSelect(item)}
                        >
                          <Text className="text-[11px] font-montserrat text-textPrimary" numberOfLines={2}>
                            {item.place_name}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              </View>

              <View className="px-3 pt-3 pb-3">
                {/* Current address preview */}
                <Text className="text-[11px] font-montserrat text-textTertiary mb-3" numberOfLines={2}>
                  {newAddress || 'Move the map to pick a location'}
                </Text>

                {/* Label selector */}
                <View className="flex-row mb-3" style={{ gap: 6 }}>
                  {(['home', 'work', 'other'] as AddressLabel[]).map((label) => {
                    const LabelIcon = LABEL_ICONS[label];
                    return (
                      <Pressable
                        key={label}
                        onPress={() => setNewLabel(label)}
                        className={`flex-row items-center px-3 py-1.5 rounded-lg border ${
                          newLabel === label
                            ? 'bg-primary border-primary'
                            : 'border-divider bg-background'
                        }`}
                      >
                        <LabelIcon size={12} color={newLabel === label ? '#FFFFFF' : '#64748B'} />
                        <Text
                          className={`text-[11px] font-montserrat-semi capitalize ml-1.5 ${
                            newLabel === label ? 'text-white' : 'text-textSecondary'
                          }`}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Custom label input for "other" */}
                {newLabel === 'other' && (
                  <TextInput
                    className="border border-divider rounded-lg px-3 py-2 mb-3 text-xs font-montserrat text-textPrimary bg-background"
                    placeholder="e.g. Mark's house, Gym, School..."
                    placeholderTextColor="#94A3B8"
                    value={customLabel}
                    onChangeText={setCustomLabel}
                  />
                )}

                <Button
                  title={saving ? 'Saving...' : editingId ? 'Update' : 'Save Address'}
                  onPress={handleAdd}
                  disabled={saving || !newAddress.trim()}
                  size="sm"
                  fullWidth
                />
              </View>
            </View>
          )}

          {/* Address List */}
          {!loading && addresses.length === 0 && !showAdd ? (
            <View className="items-center py-16">
              <View className="w-14 h-14 rounded-full bg-slate-100 items-center justify-center mb-3">
                <MapPin size={24} color="#94A3B8" />
              </View>
              <Text className="text-sm font-montserrat-semi text-textSecondary">
                No saved addresses
              </Text>
              <Text className="text-xs font-montserrat text-textTertiary mt-1">
                Tap + to add your first address
              </Text>
            </View>
          ) : (
            addresses.map((addr) => {
              const Icon = LABEL_ICONS[addr.label] ?? MapPin;
              return (
                <Pressable
                  key={addr.id}
                  className="flex-row items-center bg-surface rounded-xl px-3 py-3 mb-2 border border-divider"
                  onPress={() => handleEdit(addr)}
                >
                  <View className="w-9 h-9 rounded-full bg-primary50 items-center justify-center mr-3">
                    <Icon size={16} color="#2563EB" />
                  </View>
                  <View className="flex-1 mr-2">
                    <Text className="text-[13px] font-montserrat-semi text-textPrimary capitalize">
                      {addr.label}
                    </Text>
                    <Text className="text-[11px] font-montserrat text-textTertiary mt-0.5" numberOfLines={2}>
                      {addr.address}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleDelete(addr.id)}
                    className="w-8 h-8 rounded-lg items-center justify-center"
                    hitSlop={8}
                  >
                    <Trash2 size={15} color="#EF4444" />
                  </Pressable>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}

      <ConfirmModal
        visible={!!pendingDeleteId}
        title="Delete address?"
        message="Remove this saved address from your account?"
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        loading={deletingAddress}
        onConfirm={confirmDeleteAddress}
        onCancel={() => setPendingDeleteId(null)}
      />
    </SafeAreaView>
  );
}
