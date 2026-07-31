import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { MapPin, Trash2, Home, Briefcase, Star, X, Search, LocateFixed } from 'lucide-react-native';
import * as Location from 'expo-location';
import { HereMapView, type HereMapViewRef } from '../../../components/map';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { ErrorState } from '../../../components/ui/ErrorState';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Illustration } from '../../../components/ui/Illustration';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { Skeleton } from '../../../components/ui/Skeleton';
import { useDebounce } from '../../../hooks/useDebounce';
import { useQuery } from '../../../hooks/useQuery';
import { useResponsive } from '../../../constants/responsive';
import { useAuthStore } from '../../../stores/authStore';
import { CacheTTL } from '../../../services/cache.service';
import { userService } from '../../../services/user.service';
import { geocodingService } from '../../../services/geocoding.service';
import { getCurrentCoords } from '../../../utils/locationPermission';
import { runOptimistic } from '../../../utils/optimistic';
import { queueable } from '../../../services/mutationQueue';
import { LightColors, Elevation } from '../../../constants/colors';
import { copy } from '../../../constants/copy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const { contentMaxWidth } = useResponsive();
  return (
    <View
      className="flex-1 bg-background px-5 pt-1"
      style={{ maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}
    >
      {[1, 2, 3].map((i) => (
        <View key={i} className="flex-row items-center bg-surface rounded-2xl p-3 mb-2.5" style={Elevation.sm}>
          <Skeleton width={40} height={40} borderRadius={20} />
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
  const { contentMaxWidth } = useResponsive();
  const insets = useSafeAreaInsets();
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
  const [newLabel, setNewLabel] = useState<AddressLabel>('home');
  const [customLabel, setCustomLabel] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newLat, setNewLat] = useState(0);
  const [newLng, setNewLng] = useState(0);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);

  // Map search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ place_name: string; center: [number, number] }>>([]);
  const debouncedSearch = useDebounce(searchQuery, 400);
  const mapRef = useRef<HereMapViewRef>(null);
  const scrollRef = useRef<ScrollView>(null);
  const geocodeTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Holds the just-deleted record so the undo toast can re-create it.
  const deletedAddress = useRef<SavedAddress | null>(null);

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
      .search(debouncedSearch, 5, undefined, proximity)
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

  // Drop the pin on the user's current location + reverse-geocode it.
  // `prompt` toggles whether we ask for permission (the recenter button) or
  // stay silent (the on-open seed, which must never pop a dialog).
  const centerOnCurrentLocation = useCallback(
    async (prompt: boolean) => {
      const pos = await getCurrentCoords({
        requirePermission: prompt,
        feature: 'center the map on your location',
        accuracy: Location.Accuracy.High,
      });
      if (!pos) {
        if (prompt) toast.error('Could not get your location. Try searching instead.');
        return;
      }
      setNewLat(pos.lat);
      setNewLng(pos.lng);
      mapRef.current?.animateToRegion(
        { latitude: pos.lat, longitude: pos.lng, latitudeDelta: 0.008, longitudeDelta: 0.008 },
        800,
      );
      const addr = await reverseGeocode(pos.lng, pos.lat);
      setNewAddress(addr);
    },
    [reverseGeocode],
  );

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
    const fields = { label: finalLabel, address: trimmedAddress, lat: newLat, lng: newLng };
    const isEdit = !!editingId;
    const editId = editingId;
    const prev = addressesQ.data ?? [];

    // Close the form and reflect the change in the list immediately; the server
    // write happens in the background and the list is rolled back on failure.
    setNewAddress('');
    setCustomLabel('');
    setShowAdd(false);
    setEditingId(null);

    await runOptimistic({
      apply: () =>
        addressesQ.mutate((list) => {
          const current = list ?? [];
          if (isEdit) {
            return current.map((a) => (a.id === editId ? { ...a, ...fields } : a));
          }
          // Temp id is replaced by the server record when `invalidate` refetches.
          const tempRow = { id: `temp-${Date.now()}`, ...fields, is_default: false } as SavedAddress;
          return [...current, tempRow];
        }),
      rollback: () => addressesQ.mutate(() => prev),
      commit: () =>
        isEdit
          ? userService.updateAddress(editId as string, fields)
          : userService.addAddress({ ...fields, is_default: false, created_at: new Date().toISOString() } as any),
      invalidate: [['user', 'addresses', userId]],
      errorMessage: copy.address.saveFailed,
      retry: true,
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        toast.success('Address saved');
      },
    });
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
    // The inline form is anchored to the top of the list; bring it into
    // view so tapping a row scrolled far down doesn't appear to do nothing.
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const handleDelete = (id: string) => {
    // Warning cue as the destructive confirm surfaces.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setPendingDeleteId(id);
  };

  // Promote an address to the account default. The server already
  // supports `is_default` (SavedAddress carries the field); this exposes
  // it as a one-tap star on each non-default card. Refresh from source so
  // the previous default's flag clears too.
  const handleSetDefault = useCallback(
    async (addr: SavedAddress) => {
      if (addr.is_default || settingDefaultId) return;
      Haptics.selectionAsync().catch(() => {});
      setSettingDefaultId(addr.id);
      // Optimistic: move the "default" star to this row instantly, then
      // confirm with the server. On failure the previous list is restored
      // and an error is shown. On success we invalidate so the confirmed
      // server state (which also clears the prior default) is re-fetched.
      const prev = addressesQ.data ?? [];
      // Queueable so promoting a default while offline is kept and replayed on
      // reconnect; dedupeKey collapses rapid re-picks to the last one chosen.
      const q = queueable(
        'user.updateAddress',
        { id: addr.id, data: { is_default: true } },
        { invalidate: [['user', 'addresses', userId]], dedupeKey: 'addr-default' },
      );
      await runOptimistic({
        apply: () =>
          addressesQ.mutate((list) =>
            (list ?? []).map((a) => ({ ...a, is_default: a.id === addr.id })),
          ),
        rollback: () => addressesQ.mutate(prev),
        commit: q.commit,
        offline: q.offline,
        invalidate: [['user', 'addresses', userId]],
        errorMessage: copy.address.updateFailed,
        retry: true,
        onSuccess: () =>
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
      });
      setSettingDefaultId(null);
    },
    [addressesQ, settingDefaultId, userId],
  );

  // Re-create a just-deleted address (undo path). Coordinates and label
  // are carried over from the captured record; the id/default flag are
  // reassigned by the server on re-add.
  const undoDelete = useCallback(async () => {
    const removed = deletedAddress.current;
    if (!removed) return;
    deletedAddress.current = null;
    try {
      await userService.addAddress({
        label: removed.label,
        address: removed.address,
        lat: removed.lat,
        lng: removed.lng,
        is_default: false,
        created_at: new Date().toISOString(),
      } as any);
      await addressesQ.refresh();
    } catch {
      toast.error('Couldn’t restore address');
    }
  }, [addressesQ]);

  const confirmDeleteAddress = async () => {
    const id = pendingDeleteId;
    if (!id) return;
    // Optimistic: close the confirm modal and drop the row instantly; on
    // failure the row is restored and an error shown. `invalidate` refetches
    // from source (which also re-syncs a server-promoted default).
    const prev = addressesQ.data ?? [];
    deletedAddress.current = addresses.find((a) => a.id === id) ?? null;
    setPendingDeleteId(null);
    await runOptimistic({
      apply: () => addressesQ.mutate((list) => (list ?? []).filter((a) => a.id !== id)),
      rollback: () => addressesQ.mutate(() => prev),
      commit: () => userService.deleteAddress(id),
      invalidate: [['user', 'addresses', userId]],
      errorMessage: copy.address.deleteFailed,
      retry: true,
      onSuccess: () =>
        toast.success('Address removed', { actionLabel: 'Undo', onAction: undoDelete }),
    });
  };

  const resetForm = () => {
    const opening = !showAdd;
    setShowAdd(opening);
    setEditingId(null);
    setNewAddress('');
    setNewLabel('home');
    setCustomLabel('');
    setNewLat(0);
    setNewLng(0);
    setSearchQuery('');
    setSearchResults([]);
    if (opening) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      // Seed the map on the user's current location for convenience — but
      // SILENTLY (no permission dialog on form-open). If location is already
      // granted the pin lands on the user; otherwise the map stays on the
      // default center and the recenter button prompts on demand.
      centerOnCurrentLocation(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Saved Addresses"
        showBack
        fallbackHref="/(customer)/(tabs)/profile"
        trailing={{
          label: showAdd ? 'Cancel' : '+ Add',
          onPress: resetForm,
        }}
      />

      {/* Subtle brand accent — a faint 3D location pin tucked into the
          top-right of the header band. Purely decorative: pointer-events
          are off so it never intercepts the "+ Add" action beneath it, and
          the low opacity keeps it a whisper rather than a hero. Coexists
          with the empty-state illustration further down the list. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: insets.top + 2, right: -12, opacity: 0.14, zIndex: 5 }}
      >
        <Illustration name="3d-pin" size={64} />
      </View>

      {loading ? (
        <AddressSkeleton />
      ) : addressesQ.error && addresses.length === 0 ? (
        // A failed fetch used to fall through to the empty state, which
        // told the user they had no addresses when we simply couldn't load
        // them. Surface a real error with a retry instead.
        <ErrorState
          title="Couldn't load your addresses"
          onRetry={fetchAddresses}
        />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          // Offset must equal the real distance from the top of the screen to
          // the KAV (the header sits above it): safe-area top + the ~52pt title
          // row + the header's 16pt bottom margin. A fixed value under-shot on
          // notch devices, leaving the custom-label field under the keyboard.
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 52 + 16 : 0}
        >
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          showsVerticalScrollIndicator={false}
          refreshControl={<BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 4,
            paddingBottom: 100,
            // Let the empty state's flex-1 fill the viewport so it centers
            // instead of hugging the top under the header.
            flexGrow: 1,
            maxWidth: contentMaxWidth,
            width: '100%',
            alignSelf: 'center',
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Add / Edit Form with Map */}
          {showAdd && (
            <View className="mb-4 rounded-2xl bg-surface overflow-hidden border border-divider">
              {/* Map Picker — raised above the fields below so the search
                  results overlay can extend past the map and paint on top. */}
              <View style={{ height: 180, zIndex: 10 }}>
                <HereMapView
                  style={{ flex: 1 }}
                  ref={mapRef}
                  showsUserLocation
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
                  <MapPin
                    size={24}
                    color={LightColors.primary}
                    fill={LightColors.primary}
                  />
                </View>

                {/* Recenter-to-me — prompts for location if needed, then
                    drops the pin on the user's current position. */}
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    centerOnCurrentLocation(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Center map on my current location"
                  style={({ pressed }) => [
                    {
                      position: 'absolute',
                      bottom: 10,
                      right: 10,
                      width: 38,
                      height: 38,
                      borderRadius: 12,
                      backgroundColor: LightColors.surface,
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 20,
                    },
                    Elevation.md,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <LocateFixed size={19} color={LightColors.primary} strokeWidth={2.2} />
                </Pressable>

                {/* Search overlay — high stacking priority so its results
                    list paints above the label/preview fields below the map
                    instead of being covered or clipped by them. */}
                <View style={{ position: 'absolute', top: 8, left: 8, right: 8, zIndex: 30, elevation: 30 }}>
                  <View
                    className="flex-row items-center bg-white/95 rounded-lg px-2.5"
                    style={[Elevation.sm, { minHeight: 40 }]}
                  >
                    <Search size={16} color={LightColors.textMuted} strokeWidth={2} />
                    <TextInput
                      className="flex-1 text-xs font-montserrat text-textPrimary ml-2 py-0"
                      placeholder="Search location..."
                      placeholderTextColor={LightColors.textMuted}
                      accessibilityLabel="Search for a location"
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      returnKeyType="search"
                    />
                    {searchQuery.length > 0 && (
                      <Pressable
                        onPress={() => { setSearchQuery(''); setSearchResults([]); }}
                        accessibilityRole="button"
                        accessibilityLabel="Clear search"
                        hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                      >
                        <X size={16} color={LightColors.textMuted} strokeWidth={2} />
                      </Pressable>
                    )}
                  </View>
                  {searchResults.length > 0 && (
                    <ScrollView
                      className="bg-white rounded-lg mt-1 overflow-hidden"
                      style={[Elevation.md, { maxHeight: 176 }]}
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled
                    >
                      {searchResults.map((item, i) => (
                        <Pressable
                          key={i}
                          className="px-3 py-2.5 border-b border-divider justify-center min-h-[44px]"
                          onPress={() => handleSearchSelect(item)}
                          accessibilityRole="button"
                          accessibilityLabel={item.place_name}
                        >
                          <Text className="text-[11px] font-montserrat text-textPrimary" numberOfLines={2}>
                            {item.place_name}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
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
                        onPress={() => {
                          Haptics.selectionAsync().catch(() => {});
                          setNewLabel(label);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Label as ${label}`}
                        accessibilityState={{ selected: newLabel === label }}
                        hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
                        className={`flex-row items-center px-3 py-1.5 rounded-lg border ${
                          newLabel === label
                            ? 'bg-primary border-primary'
                            : 'border-divider bg-background'
                        }`}
                      >
                        <LabelIcon
                          size={12}
                          color={
                            newLabel === label
                              ? LightColors.textInverse
                              : LightColors.textTertiary
                          }
                        />
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
                  <View className="mb-3">
                    <Input
                      label="Label"
                      placeholder="e.g. Mark's house, Gym, School..."
                      value={customLabel}
                      onChangeText={setCustomLabel}
                      autoCapitalize="words"
                      returnKeyType="done"
                      onSubmitEditing={handleAdd}
                    />
                  </View>
                )}

                <Button
                  title={editingId ? 'Update' : 'Save Address'}
                  onPress={handleAdd}
                  disabled={!newAddress.trim()}
                  size="sm"
                  fullWidth
                />
              </View>
            </View>
          )}

          {/* Address List */}
          {!loading && addresses.length === 0 && !showAdd ? (
            <EmptyState
              illustration={<Illustration name="empty-addresses" size={180} />}
              title="No saved addresses"
              description="Save the places you go most for faster booking."
              actionLabel="Add an address"
              onAction={resetForm}
            />
          ) : (
            addresses.map((addr) => {
              const Icon = LABEL_ICONS[addr.label] ?? MapPin;
              return (
                <Card
                  key={addr.id}
                  onPress={() => handleEdit(addr)}
                  padding="sm"
                  className="mb-2.5"
                  accessibilityLabel={`Edit ${addr.label} address`}
                >
                  <View className="flex-row items-center">
                    {/* Leading icon chip — neutral grey circle, primary icon. */}
                    <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center mr-3">
                      <Icon
                        size={18}
                        color={LightColors.primary}
                        strokeWidth={2}
                      />
                    </View>
                    <View className="flex-1 mr-2">
                      <Text className="text-[14px] font-montserrat-bold text-textPrimary capitalize">
                        {addr.label}
                      </Text>
                      <Text className="text-[12px] font-montserrat text-textSecondary mt-0.5" numberOfLines={2}>
                        {addr.address}
                      </Text>
                    </View>
                    {addr.is_default ? (
                      <View
                        className="flex-row items-center rounded-full px-2.5 py-1 mr-2"
                        style={{ backgroundColor: LightColors.accentSoft }}
                        accessibilityLabel="Default address"
                      >
                        <Star size={11} color={LightColors.accentStrong} fill={LightColors.accentStrong} strokeWidth={0} />
                        <Text
                          className="text-[10px] font-montserrat-bold uppercase ml-1"
                          style={{ color: LightColors.accentDark, letterSpacing: 0.5 }}
                        >
                          Default
                        </Text>
                      </View>
                    ) : (
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          handleSetDefault(addr);
                        }}
                        disabled={settingDefaultId === addr.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Set ${addr.label} as default address`}
                        className="w-9 h-9 items-center justify-center mr-2"
                        // 4pt slop (not 6): 36pt box + 8pt slop = a 44pt target
                        // with no overlap into the adjacent destructive delete
                        // control (6pt slop on both bled 4pt into each other).
                        hitSlop={4}
                        style={{ opacity: settingDefaultId === addr.id ? 0.4 : 1 }}
                      >
                        <Star size={18} color={LightColors.textTertiary} strokeWidth={2} />
                      </Pressable>
                    )}
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        handleDelete(addr.id);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${addr.label} address`}
                      className="w-9 h-9 items-center justify-center"
                      hitSlop={4}
                    >
                      <Trash2
                        size={18}
                        color={LightColors.danger}
                        strokeWidth={2}
                      />
                    </Pressable>
                  </View>
                </Card>
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
        onConfirm={confirmDeleteAddress}
        onCancel={() => setPendingDeleteId(null)}
      />
    </View>
  );
}
