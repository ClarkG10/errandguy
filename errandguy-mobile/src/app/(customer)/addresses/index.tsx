import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, TextInput, Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, Plus, MapPin, Trash2, Pencil, Home, Briefcase, Star, X, Search } from 'lucide-react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { Button } from '../../../components/ui/Button';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Skeleton } from '../../../components/ui/Skeleton';
import { useDebounce } from '../../../hooks/useDebounce';
import { useQuery } from '../../../hooks/useQuery';
import { useAuthStore } from '../../../stores/authStore';
import { CacheTTL } from '../../../services/cache.service';
import { userService } from '../../../services/user.service';
import { geocodingService } from '../../../services/geocoding.service';

import type { SavedAddress } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { LocationIllustration } from '../../../components/auth/OnboardingIllustrations';

type AddressLabel = 'home' | 'work' | 'other';

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
  const mapRef = useRef<MapView>(null);
  const geocodeTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchAddresses = useCallback(async () => {
    await addressesQ.refresh();
  }, [addressesQ]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await addressesQ.refresh();
    setRefreshing(false);
  }, [addressesQ]);

  /* ── Reverse geocode (cached) ── */
  const reverseGeocode = useCallback(
    (lng: number, lat: number) => geocodingService.reverse(lng, lat),
    [],
  );

  /* ── Search geocoding (cached, proximity-biased) ──
     Bias to whatever the user has the map centered on right now (the pin
     coords) so search for a coffee shop returns the branch near them
     instead of one on the other side of the country. */
  useEffect(() => {
    if (debouncedSearch.length < 2) {
      setSearchResults([]);
      return;
    }
    const proximity =
      newLat && newLng ? { lng: newLng, lat: newLat } : undefined;
    let cancelled = false;
    geocodingService
      .search(debouncedSearch, 8, undefined, proximity)
      .then((features) => {
        if (cancelled) return;
        setSearchResults(features);
      });
    return () => { cancelled = true; };
    // proximity intentionally excluded so we only refetch when the
    // *query* changes, not on every map nudge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // Cancel any pending reverse-geocode write when the screen unmounts so
  // we don't fire setState on an unmounted component (harmless warning,
  // but it also keeps stale geocodes from clobbering the next session).
  useEffect(() => {
    return () => {
      if (geocodeTimeout.current) clearTimeout(geocodeTimeout.current);
    };
  }, []);

  const handleSearchSelect = useCallback((item: { place_name: string; center: [number, number] }) => {
    setSearchQuery('');
    setSearchResults([]);
    Keyboard.dismiss();
    setNewAddress(item.place_name);
    setNewLng(item.center[0]);
    setNewLat(item.center[1]);
    mapRef.current?.animateToRegion({ latitude: item.center[1], longitude: item.center[0], latitudeDelta: 0.008, longitudeDelta: 0.008 }, 800);
  }, []);

  const handleMapRegionDidChange = useCallback((region: { latitude: number; longitude: number }) => {
    if (geocodeTimeout.current) clearTimeout(geocodeTimeout.current);
    geocodeTimeout.current = setTimeout(async () => {
      setNewLng(region.longitude);
      setNewLat(region.latitude);
      const addr = await reverseGeocode(region.longitude, region.latitude);
      setNewAddress(addr);
    }, 300);
  }, [reverseGeocode]);

  const handleAdd = async () => {
    const trimmedAddress = newAddress.trim();
    if (!trimmedAddress) return;
    // Coordinates are required — saved addresses without lat/lng break the
    // booking flow (map can't pre-center, fare estimate skips them, runner
    // can't navigate). Guard here instead of letting the user save junk.
    const hasValidCoords =
      Number.isFinite(newLat) &&
      Number.isFinite(newLng) &&
      Math.abs(newLat) > 0.0001 &&
      Math.abs(newLng) > 0.0001;
    if (!hasValidCoords) {
      toast.error('Please pin a location on the map');
      return;
    }
    const finalLabel = newLabel === 'other' && customLabel.trim() ? customLabel.trim() : newLabel;
    setSaving(true);
    try {
      if (editingId) {
        await userService.updateAddress(editingId, {
          label: finalLabel,
          address: trimmedAddress,
          lat: newLat,
          lng: newLng,
        });
      } else {
        await userService.addAddress({
          label: finalLabel,
          address: trimmedAddress,
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
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Saved addresses"
        showBack
        fallbackHref="/(customer)/(tabs)/profile"
        trailing={{
          label: showAdd ? 'Cancel' : '+ Add',
          onPress: resetForm,
        }}
      />

      {loading ? (
        <AddressSkeleton />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
        >
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Add / Edit Form with Map */}
          {showAdd && (
            <View className="mb-4 rounded-2xl bg-surface overflow-hidden border border-divider">
              {/* Map Picker */}
              <View style={{ height: 180 }}>
                <MapView
                  style={{ flex: 1 }}
                  ref={mapRef}
                  provider={PROVIDER_GOOGLE}
                  onRegionChangeComplete={handleMapRegionDidChange}
                  initialRegion={{
                    latitude: newLat && newLng ? newLat : DEFAULT_CENTER[1],
                    longitude: newLat && newLng ? newLng : DEFAULT_CENTER[0],
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  }}
                />
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
            <View className="items-center py-10">
              <LocationIllustration size={180} />
              <Text className="text-base font-montserrat-bold text-textPrimary mt-2">
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
                  className="flex-row items-center px-1 py-3.5 border-b border-divider"
                  onPress={() => handleEdit(addr)}
                >
                  <Icon size={18} color="#475569" strokeWidth={1.6} style={{ marginRight: 14 }} />
                  <View className="flex-1 mr-2">
                    <Text className="text-[14px] font-montserrat-bold text-textPrimary capitalize">
                      {addr.label}
                    </Text>
                    <Text className="text-[12px] font-montserrat text-textMuted mt-0.5" numberOfLines={2}>
                      {addr.address}
                    </Text>
                  </View>
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      handleDelete(addr.id);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${addr.label} address`}
                    className="w-9 h-9 items-center justify-center"
                    hitSlop={8}
                  >
                    <Trash2 size={15} color="#EF4444" strokeWidth={1.6} />
                  </Pressable>
                </Pressable>
              );
            })
          )}
        </ScrollView>
        </KeyboardAvoidingView>
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
    </View>
  );
}
