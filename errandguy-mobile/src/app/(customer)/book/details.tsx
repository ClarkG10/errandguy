import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Animated,
  StyleSheet,
  useWindowDimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Search,
  X,
  Navigation,
  Bookmark,
  ChevronDown,
  ChevronUp,
  UserPlus,
  Crosshair,
  Map as MapIcon,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HereMapView, HereMarker, HerePolyline, type HereMapViewRef, type Region } from '../../../components/map';
import * as Location from 'expo-location';
import { ensureLocationPermission, getCurrentCoords } from '../../../utils/locationPermission';
import { useBookingStore } from '../../../stores/bookingStore';
import { useImagePicker } from '../../../hooks/useImagePicker';
import { useDebounce } from '../../../hooks/useDebounce';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { PhotoGrid } from '../../../components/customer/PhotoGrid';
import { ImagePickerModal } from '../../../components/ui/ImagePickerModal';
import { SavedAddressSheet } from '../../../components/customer/SavedAddressSheet';
import { ExpandableSheet } from '../../../components/ui/ExpandableSheet';
import { BookingStepIndicator } from '../../../components/customer/BookingStepIndicator';

import { getErrandTypeRule } from '../../../constants/errandTypeRules';
import { LightColors, Elevation } from '../../../constants/colors';
import type { SavedAddress } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { geocodingService } from '../../../services/geocoding.service';
import { routeService } from '../../../services/route.service';

const DEFAULT_CENTER: [number, number] = [121.0, 14.6];
// Step labels live in `BookingStepIndicator`; keep this file lean.

/* ─── Animated Pulse Marker (frozen pins) ─── */

function PulseMarker({ color }: { color: string }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    ).start();
  }, []);
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: 56, height: 56 }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: color,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.4] }) }],
        }}
      />
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          backgroundColor: color,
          borderWidth: 3,
          borderColor: LightColors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: LightColors.ink,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 4,
          elevation: 5,
        }}
      >
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: LightColors.surface }} />
      </View>
    </View>
  );
}

/* ─── Center Pin (drags with map) ─── */

function CenterPin({ color, isMoving }: { color: string; isMoving: boolean }) {
  const lift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(lift, {
      toValue: isMoving ? 1 : 0,
      friction: 5,
      useNativeDriver: true,
    }).start();
  }, [isMoving]);
  const translateY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -14] });
  const shadowScale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] });
  return (
    <View style={{ alignItems: 'center' }}>
      <Animated.View style={{ transform: [{ translateY }], alignItems: 'center' }}>
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 23,
            backgroundColor: color,
            borderWidth: 3,
            borderColor: LightColors.surface,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: LightColors.ink,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
            elevation: 8,
          }}
        >
          <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: LightColors.surface }} />
        </View>
        <View
          style={{
            width: 0,
            height: 0,
            alignSelf: 'center',
            marginTop: -2,
            borderLeftWidth: 9,
            borderRightWidth: 9,
            borderTopWidth: 12,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: color,
          }}
        />
      </Animated.View>
      <Animated.View
        style={{
          width: 20,
          height: 6,
          borderRadius: 3,
          backgroundColor: 'rgba(0,0,0,0.15)',
          marginTop: 2,
          transform: [{ scaleX: shadowScale }],
        }}
      />
    </View>
  );
}

/* ─── Main Screen ─── */

export default function TaskDetailsScreen() {
  const router = useRouter();
  const { draftBooking, updateDraft, setStep } = useBookingStore();
  const { pickImage, takePhoto } = useImagePicker();
  // Listen to window dimensions so the map pane re-flows on rotation
  // and iPad split-view resizes (was a static module-level read).
  const { height: SCREEN_HEIGHT } = useWindowDimensions();

  // Per-errand-type UX rules (which fields to show, labels, etc.)
  const rule = useMemo(
    () => getErrandTypeRule(draftBooking.errand_type_slug),
    [draftBooking.errand_type_slug],
  );

  const initialPhase =
    draftBooking.pickup_lat && (rule.singleLocation || draftBooking.dropoff_lat)
      ? ('details' as const)
      : draftBooking.pickup_lat
        ? ('dropoff' as const)
        : ('pickup' as const);

  const [phase, setPhase] = useState<'pickup' | 'dropoff' | 'details'>(initialPhase);
  // Cost control: the HERE map is opt-in. Until the user explicitly taps
  // "Select on map" the MapView is NOT mounted at all — zero tile /
  // raster requests. Address entry defaults to search + saved places +
  // current location, which only hit the (cached) geocoding endpoints.
  const [mapOpen, setMapOpen] = useState(false);
  const [currentAddress, setCurrentAddress] = useState('');
  const [isMoving, setIsMoving] = useState(false);
  const [currentCoord, setCurrentCoord] = useState<[number, number] | null>(null);
  const [showSavedSheet, setShowSavedSheet] = useState(false);
  const [photoPickerVisible, setPhotoPickerVisible] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    Array<{ place_name: string; center: [number, number] }>
  >([]);
  const [recentPlaces, setRecentPlaces] = useState<
    Array<{ place_name: string; center: [number, number] }>
  >([]);
  const [showSearch, setShowSearch] = useState(false);
  const debouncedSearch = useDebounce(searchQuery, 400);

  // Hydrate recent destinations once — instant render on next focus.
  useEffect(() => {
    let cancelled = false;
    geocodingService.getRecent(6).then((items) => {
      if (!cancelled) setRecentPlaces(items);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Details form
  const [photos, setPhotos] = useState<string[]>(draftBooking.item_photos ?? []);
  const [showPickupContact, setShowPickupContact] = useState(
    !!(draftBooking.pickup_contact_name || draftBooking.pickup_contact_phone),
  );
  const [showDropoffContact, setShowDropoffContact] = useState(
    !!(draftBooking.dropoff_contact_name || draftBooking.dropoff_contact_phone),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Clear hidden-field values when switching to an errand type that
  // doesn't use them, so we don't submit stale data.
  useEffect(() => {
    const patch: Record<string, undefined> = {};
    if (!rule.showPhotos && (draftBooking.item_photos?.length ?? 0) > 0) {
      patch.item_photos = undefined;
      setPhotos([]);
    }
    if (!rule.showItemValue && draftBooking.estimated_item_value != null) {
      patch.estimated_item_value = undefined;
    }
    if (!rule.requiresShoppingBudget && draftBooking.shopping_budget != null) {
      patch.shopping_budget = undefined;
    }
    if (rule.singleLocation && draftBooking.dropoff_address) {
      patch.dropoff_address = undefined;
      patch.dropoff_lat = undefined;
      patch.dropoff_lng = undefined;
    }
    if (
      !rule.showPickupContact &&
      (draftBooking.pickup_contact_name || draftBooking.pickup_contact_phone)
    ) {
      patch.pickup_contact_name = undefined;
      patch.pickup_contact_phone = undefined;
      setShowPickupContact(false);
    }
    if (
      !rule.showDropoffContact &&
      (draftBooking.dropoff_contact_name || draftBooking.dropoff_contact_phone)
    ) {
      patch.dropoff_contact_name = undefined;
      patch.dropoff_contact_phone = undefined;
      setShowDropoffContact(false);
    }
    if (Object.keys(patch).length > 0) {
      updateDraft(patch as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule]);

  // Route
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);

  // Refs
  const mapRef = useRef<HereMapViewRef>(null);
  const geocodeTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const skipNextGeocode = useRef(false);

  const pinColor = phase === 'pickup' ? LightColors.primary : LightColors.danger;

  /* ── Reverse geocode (cached) ──
     Same coordinate within ~11 m re-uses the cached place name for 24 h.
     Cuts the chatty Mapbox traffic when the user nudges the pin. */
  const reverseGeocode = useCallback(
    (lng: number, lat: number) => geocodingService.reverse(lng, lat),
    [],
  );

  /* ── Search geocoding (cached, proximity-biased) ──
     Bias to the most relevant nearby point so a search for "jollibee" or
     "7 eleven" returns the branch a few blocks away instead of one
     across the country. Order of preference:
       1. The current map center (whatever the user is looking at)
       2. The runner's GPS position
       3. An already-selected pickup (when on dropoff phase)
     If none of those exist we fall back to an unbiased PH-wide search. */
  useEffect(() => {
    if (debouncedSearch.length < 2) {
      setSearchResults([]);
      return;
    }
    const proxSource: [number, number] | null =
      currentCoord ??
      userLocation ??
      (draftBooking.pickup_lng != null && draftBooking.pickup_lat != null && phase === 'dropoff'
        ? [draftBooking.pickup_lng, draftBooking.pickup_lat]
        : null);
    const proximity = proxSource
      ? { lng: proxSource[0], lat: proxSource[1] }
      : undefined;
    let cancelled = false;
    geocodingService
      .search(debouncedSearch, 8, undefined, proximity)
      .then((features) => {
        if (cancelled) return;
        setSearchResults(features);
      });
    return () => {
      cancelled = true;
    };
    // currentCoord/userLocation/phase intentionally read fresh — the bias
    // should track wherever the user has the map right now, but we don't
    // want to spam Mapbox on every pin nudge, so we still only fire when
    // the *query* changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const handleSearchSelect = useCallback(
    (item: { place_name: string; center: [number, number] }) => {
      // Promote to recents — fire-and-forget, never blocks the UI.
      geocodingService.addRecent(item).then(() => {
        // Refresh the local list so the next time the user opens the
        // search this pick is already at the top.
        geocodingService.getRecent(6).then(setRecentPlaces);
      });
      setSearchQuery('');
      setSearchResults([]);
      setShowSearch(false);
      Keyboard.dismiss();
      skipNextGeocode.current = true;
      setCurrentCoord(item.center);
      setCurrentAddress(item.place_name);
      mapRef.current?.animateToRegion({ latitude: item.center[1], longitude: item.center[0], latitudeDelta: 0.008, longitudeDelta: 0.008 }, 800);
    },
    [],
  );

  /* ── Map region handlers ── */
  const handleRegionChange = useCallback(() => {
    if (phase === 'details') return;
    // When we're programmatically animating the map (after a search
    // selection, "My Location" tap, or auto-detect on mount),
    // skipNextGeocode is set to true so we can skip the geocoding call
    // in handleRegionChangeComplete. We also skip clearing the address
    // here so the address we've already resolved doesn't get wiped out
    // during the animation.
    if (skipNextGeocode.current) {
      if (geocodeTimeout.current) clearTimeout(geocodeTimeout.current);
      return;
    }
    setIsMoving(true);
    setCurrentAddress('');
    if (geocodeTimeout.current) clearTimeout(geocodeTimeout.current);
  }, [phase]);

  const handleRegionChangeComplete = useCallback(
    (region: { latitude: number; longitude: number }) => {
      if (phase === 'details') return;
      setIsMoving(false);

      if (skipNextGeocode.current) {
        skipNextGeocode.current = false;
        return;
      }

      const center: [number, number] = [region.longitude, region.latitude];

      if (geocodeTimeout.current) clearTimeout(geocodeTimeout.current);
      geocodeTimeout.current = setTimeout(async () => {
        setCurrentCoord(center);
        console.log(`[details] Reverse geocoding: [${center[1]}, ${center[0]}]`);
        const addr = await reverseGeocode(center[0], center[1]);
        console.log(`[details] Geocode result: "${addr}"`);
        setCurrentAddress(addr);
      }, 300);
    },
    [phase, reverseGeocode],
  );

  /* ── Confirm pickup / dropoff ── */
  const handleConfirmLocation = useCallback(() => {
    if (!currentCoord || !currentAddress) return;
    const [lng, lat] = currentCoord;
    if (phase === 'pickup') {
      updateDraft({ pickup_address: currentAddress, pickup_lat: lat, pickup_lng: lng });
      // Single-location errands have no separate dropoff — skip to details.
      if (rule.singleLocation) {
        setPhase('details');
      } else {
        setPhase('dropoff');
        setCurrentAddress('');
        setCurrentCoord(null);
      }
    } else if (phase === 'dropoff') {
      updateDraft({ dropoff_address: currentAddress, dropoff_lat: lat, dropoff_lng: lng });
      setPhase('details');
    }
    // Location picked — unmount the map again so we stop consuming tiles.
    setMapOpen(false);
  }, [phase, currentCoord, currentAddress, updateDraft, rule.singleLocation]);

  /* ── Back ── */
  const handleBack = useCallback(() => {
    if (phase === 'pickup') {
      // Leaving the booking-details flow entirely — reset all locations
      // so a stale pickup pin doesn't follow the user back here later.
      updateDraft({
        pickup_address: undefined,
        pickup_lat: undefined,
        pickup_lng: undefined,
        dropoff_address: undefined,
        dropoff_lat: undefined,
        dropoff_lng: undefined,
      });
      router.canGoBack() ? router.back() : router.replace('/(customer)/(tabs)');
    } else if (phase === 'dropoff') {
      // Going back to pick-the-pickup. Keep the existing pickup so the
      // user doesn't have to re-search; just toggle the phase and seed
      // the camera + address from the saved pickup.
      setPhase('pickup');
      setRouteCoords([]);
      if (draftBooking.pickup_lat && draftBooking.pickup_lng) {
        const coord: [number, number] = [draftBooking.pickup_lng, draftBooking.pickup_lat];
        skipNextGeocode.current = true;
        setCurrentCoord(coord);
        setCurrentAddress(draftBooking.pickup_address ?? '');
        setTimeout(() => {
          mapRef.current?.animateToRegion({ latitude: coord[1], longitude: coord[0], latitudeDelta: 0.008, longitudeDelta: 0.008 }, 500);
        }, 100);
      } else {
        setCurrentAddress('');
        setCurrentCoord(null);
      }
    } else {
      // details → (single-location: pickup, otherwise: dropoff). For the
      // dropoff case we keep dropoff data so the user can just tap
      // Confirm again — if they want to change it they can use the
      // "Change" link on the route summary.
      if (rule.singleLocation) {
        setPhase('pickup');
        if (draftBooking.pickup_lat && draftBooking.pickup_lng) {
          const coord: [number, number] = [draftBooking.pickup_lng, draftBooking.pickup_lat];
          skipNextGeocode.current = true;
          setCurrentCoord(coord);
          setCurrentAddress(draftBooking.pickup_address ?? '');
        }
      } else {
        setPhase('dropoff');
        if (draftBooking.dropoff_lat && draftBooking.dropoff_lng) {
          const coord: [number, number] = [draftBooking.dropoff_lng, draftBooking.dropoff_lat];
          skipNextGeocode.current = true;
          setCurrentCoord(coord);
          setCurrentAddress(draftBooking.dropoff_address ?? '');
          setTimeout(() => {
            mapRef.current?.animateToRegion({
              latitude: coord[1], longitude: coord[0],
              latitudeDelta: 0.008, longitudeDelta: 0.008,
            }, 500);
          }, 100);
        }
      }
      setRouteCoords([]);
    }
  }, [phase, router, updateDraft, rule.singleLocation, draftBooking.pickup_lat, draftBooking.pickup_lng, draftBooking.pickup_address, draftBooking.dropoff_lat, draftBooking.dropoff_lng, draftBooking.dropoff_address]);

  /* ── Change a confirmed location (tapped from details phase) ── */
  const handleChangeLocation = useCallback(
    (target: 'pickup' | 'dropoff') => {
      if (target === 'pickup') {
        // Go back to pickup mode, clear pickup draft
        updateDraft({
          pickup_address: undefined,
          pickup_lat: undefined,
          pickup_lng: undefined,
          dropoff_address: undefined,
          dropoff_lat: undefined,
          dropoff_lng: undefined,
        });
        setRouteCoords([]);
        setCurrentAddress('');
        setCurrentCoord(null);
        setPhase('pickup');
      } else {
        // Go back to dropoff mode, clear dropoff draft
        updateDraft({
          dropoff_address: undefined,
          dropoff_lat: undefined,
          dropoff_lng: undefined,
        });
        setRouteCoords([]);
        setCurrentAddress('');
        setCurrentCoord(null);
        setPhase('dropoff');
        // Center on pickup so user sees context
        if (draftBooking.pickup_lng && draftBooking.pickup_lat) {
          setTimeout(() => {
            mapRef.current?.animateToRegion({
              latitude: [draftBooking.pickup_lng!, draftBooking.pickup_lat!][1], longitude: [draftBooking.pickup_lng!, draftBooking.pickup_lat!][0],
              latitudeDelta: 0.032, longitudeDelta: 0.032,
            }, 500);
          }, 100);
        }
      }
    },
    [updateDraft, draftBooking],
  );

  /* ── My location ── */
  const handleMyLocation = useCallback(async () => {
    try {
      setIsMoving(true);
      // getCurrentCoords handles permission + a timeout + last-known fallback,
      // so this never hangs forever on weak GPS or a simulator with no fix.
      const pos = await getCurrentCoords({
        feature: 'set your pickup point',
        accuracy: Location.Accuracy.High,
      });
      if (!pos) {
        toast.error('Could not get your location. Try searching instead.');
        return;
      }
      const coords: [number, number] = [pos.lng, pos.lat];
      skipNextGeocode.current = true;
      setCurrentCoord(coords);
      mapRef.current?.animateToRegion({
        latitude: coords[1], longitude: coords[0],
        latitudeDelta: 0.008, longitudeDelta: 0.008,
      }, 800);
      const addr = await reverseGeocode(coords[0], coords[1]);
      setCurrentAddress(addr);
    } catch (err) {
      console.error('[details] handleMyLocation error:', err);
      toast.error('Could not get your location.');
    } finally {
      setIsMoving(false);
    }
  }, [reverseGeocode]);

  /* ── Saved address ── */
  const handleSavedAddressSelect = useCallback((address: SavedAddress) => {
    const coords: [number, number] = [address.lng, address.lat];
    skipNextGeocode.current = true;
    setCurrentCoord(coords);
    setCurrentAddress(address.address);
    mapRef.current?.animateToRegion({
              latitude: coords[1], longitude: coords[0],
              latitudeDelta: 0.008, longitudeDelta: 0.008,
            }, 800);
  }, []);

  /* ── Fetch route (cached) ──
     Only when the map is actually mounted — the polyline is its sole
     consumer, so skipping the fetch while the map is closed saves a
     routing call per booking. */
  useEffect(() => {
    if (!mapOpen) return;
    if (phase !== 'details') return;
    if (!draftBooking.pickup_lat || !draftBooking.dropoff_lat) return;
    let cancelled = false;
    routeService
      .getRoute(
        { lng: Number(draftBooking.pickup_lng), lat: Number(draftBooking.pickup_lat) },
        { lng: Number(draftBooking.dropoff_lng), lat: Number(draftBooking.dropoff_lat) },
      )
      .then((res) => {
        if (cancelled || !res) return;
        setRouteCoords(res.coordinates);
      });
    return () => {
      cancelled = true;
    };
  }, [phase, draftBooking.pickup_lat, draftBooking.pickup_lng, draftBooking.dropoff_lat, draftBooking.dropoff_lng]);

  const routeMapCoords = useMemo(() => {
    return routeCoords.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  }, [routeCoords]);

  /* ── Fit bounds (details phase) ── */
  useEffect(() => {
    if (phase !== 'details') return;
    if (!draftBooking.pickup_lat || !draftBooking.dropoff_lat) return;
    const ne = [
      Math.max(draftBooking.pickup_lng!, draftBooking.dropoff_lng!),
      Math.max(draftBooking.pickup_lat!, draftBooking.dropoff_lat!),
    ] as [number, number];
    const sw = [
      Math.min(draftBooking.pickup_lng!, draftBooking.dropoff_lng!),
      Math.min(draftBooking.pickup_lat!, draftBooking.dropoff_lat!),
    ] as [number, number];
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(
        [{ latitude: sw[1], longitude: sw[0] }, { latitude: ne[1], longitude: ne[0] }],
        { edgePadding: { top: 60, bottom: 40, left: 60, right: 60 }, animated: true },
      );
    }, 300);
    return () => clearTimeout(t);
  }, [phase, draftBooking.pickup_lat, draftBooking.pickup_lng, draftBooking.dropoff_lat, draftBooking.dropoff_lng]);

  /* ── Auto-center on user location at mount (pickup phase only,
     and only when there's no saved pickup yet). The previous version
     had two competing useEffects that both fetched location at mount
     — they raced each other into setCamera and the geocoded address
     could flicker. Consolidated below. ── */

  /* ── Photos ── */
  const handleAddPhoto = useCallback(() => {
    setPhotoPickerVisible(true);
  }, []);

  const handlePhotoConfirm = useCallback(
    (uri: string) => {
      setPhotoPickerVisible(false);
      const updated = [...photos, uri];
      setPhotos(updated);
      updateDraft({ item_photos: updated });
    },
    [photos, updateDraft],
  );

  const handleRemovePhoto = useCallback(
    (index: number) => {
      const updated = photos.filter((_, i) => i !== index);
      setPhotos(updated);
      updateDraft({ item_photos: updated });
    },
    [photos, updateDraft],
  );

  /* ── Continue ── */
  const handleContinue = useCallback(() => {
    const newErrors: Record<string, string> = {};
    if (!draftBooking.pickup_address) newErrors.pickup = 'Pickup location is required';
    if (!rule.singleLocation && !draftBooking.dropoff_address) {
      newErrors.dropoff = 'Dropoff location is required';
    }
    if (rule.descriptionRequired && !draftBooking.description?.trim()) {
      newErrors.description = `${rule.descriptionLabel} is required`;
    }
    if (rule.requiresShoppingBudget) {
      const budget = draftBooking.shopping_budget;
      if (budget == null || budget <= 0) {
        newErrors.shopping_budget = 'Shopping budget is required';
      }
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    setStep(2);
    router.push('/(customer)/book/schedule');
  }, [draftBooking, rule, setStep, router]);

  /* ── Initial camera center ── */
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);

  const initialCenter = useMemo(() => {
    if (draftBooking.pickup_lat && phase !== 'pickup') {
      return [draftBooking.pickup_lng!, draftBooking.pickup_lat!] as [number, number];
    }
    return DEFAULT_CENTER;
  }, []);

  /* ── Auto-fill current location on pickup phase ── */
  useEffect(() => {
    if (phase !== 'pickup' || draftBooking.pickup_lat) return;
    let cancelled = false;
    (async () => {
      try {
        // Silent check only — auto-fill must never pop a dialog on screen
        // load. If not already granted we simply skip; the "My location"
        // button (which calls ensureLocationPermission) handles prompting.
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const coord: [number, number] = [loc.coords.longitude, loc.coords.latitude];
        setUserLocation(coord);
        setCurrentCoord(coord);
        skipNextGeocode.current = true;
        mapRef.current?.animateToRegion({ latitude: coord[1], longitude: coord[0], latitudeDelta: 0.008, longitudeDelta: 0.008 }, 800);
        const addr = await reverseGeocode(coord[0], coord[1]);
        if (!cancelled) setCurrentAddress(addr);
      } catch {
        // Location unavailable — keep default center
      }
    })();
    return () => { cancelled = true; };
  }, [phase]);

  /* ── Render ── */
  return (
    <View style={{ flex: 1, backgroundColor: LightColors.background }}>
      {/* ═══ MAP ═══
          Opt-in: the map is NOT auto-shown. By default the user picks a
          location via search / current / saved (all of which set the
          address directly). Tapping "Select on map" mounts the map for
          pin-drag fine-tuning — so no HERE tiles load unless requested. */}
      <View style={{ flex: 1 }}>
        {mapOpen && (
        <HereMapView
          style={{ flex: 1 }}
          ref={mapRef}
          onRegionChangeComplete={handleRegionChangeComplete}
          onRegionChange={handleRegionChange}
          onPress={() => {
            setShowSearch(false);
            Keyboard.dismiss();
          }}
          initialRegion={{
            latitude: (currentCoord ?? initialCenter)[1],
            longitude: (currentCoord ?? initialCenter)[0],
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
        >
          {/* Frozen pickup marker */}
          {phase !== 'pickup' && draftBooking.pickup_lng != null && draftBooking.pickup_lat != null && (
            <HereMarker
              coordinate={{ latitude: draftBooking.pickup_lat, longitude: draftBooking.pickup_lng }}
              anchor={{ x: 0.5, y: 1 }}
              id="pickup-marker"
            >
              <PulseMarker color={LightColors.primary} />
            </HereMarker>
          )}

          {/* Frozen dropoff marker */}
          {phase === 'details' && draftBooking.dropoff_lng != null && draftBooking.dropoff_lat != null && (
            <HereMarker
              coordinate={{ latitude: draftBooking.dropoff_lat, longitude: draftBooking.dropoff_lng }}
              anchor={{ x: 0.5, y: 1 }}
              id="dropoff-marker"
            >
              <PulseMarker color={LightColors.danger} />
            </HereMarker>
          )}

          {/* Route polyline — cased for visibility over busy tiles. */}
          {routeMapCoords.length > 0 && (
            <>
              <HerePolyline id="route-outline" coordinates={routeMapCoords} strokeColor={LightColors.primary900} strokeWidth={8} lineJoin="round" />
              <HerePolyline id="route-fill" coordinates={routeMapCoords} strokeColor={LightColors.primary500} strokeWidth={5} lineJoin="round" />
            </>
          )}
        </HereMapView>
        )}

        {/* Center pin overlay — only meaningful while the map is open. */}
        {mapOpen && phase !== 'details' && (
          <View style={st.centerPinWrap} pointerEvents="none">
            <View style={{ transform: [{ translateY: -32 }] }}>
              <CenterPin color={pinColor} isMoving={isMoving} />
            </View>
          </View>
        )}

        {/* Close-map button — collapse back to address entry (keeps selection). */}
        {mapOpen && (
          <Pressable
            onPress={() => setMapOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close map"
            hitSlop={8}
            style={st.closeMapBtn}
          >
            <X size={18} color={LightColors.textPrimary} strokeWidth={2.4} />
          </Pressable>
        )}

        {/* ── Floating header ── */}
        <SafeAreaView style={st.floatingHeader} edges={['top']} pointerEvents="box-none">
          <View style={st.headerRow}>
            <Pressable
              onPress={handleBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={8}
              style={st.backBtn}
            >
              <ArrowLeft size={20} color={LightColors.textPrimary} />
            </Pressable>
            <Text style={st.phaseTitle}>
              {phase === 'pickup' ? 'Set pickup' : phase === 'dropoff' ? 'Set dropoff' : 'Add details'}
            </Text>
          </View>

          {/* Step indicator pinned under the back row — sits in a soft
              translucent card so it stays legible whether the map below
              is in dark park, light city, or satellite mode. */}
          <View style={st.stepIndicatorBackdrop}>
            <BookingStepIndicator currentStep={phase === 'pickup' ? 0 : 1} />
          </View>

          {/* Floating search bar */}
          {phase !== 'details' && (
            <View style={st.searchWrap}>
              <View style={st.searchBar}>
                <Search size={18} color={LightColors.textMuted} />
                <TextInput
                  style={st.searchInput}
                  placeholder={
                    phase === 'pickup'
                      ? `Search ${rule.pickupLabel.toLowerCase()}...`
                      : `Search ${rule.dropoffLabel.toLowerCase()}...`
                  }
                  placeholderTextColor={LightColors.textMuted}
                  value={searchQuery}
                  onChangeText={(t) => {
                    setSearchQuery(t);
                    setShowSearch(true);
                  }}
                  onFocus={() => setShowSearch(true)}
                  returnKeyType="search"
                />
                {searchQuery.length > 0 && (
                  <Pressable
                    onPress={() => {
                      setSearchQuery('');
                      setSearchResults([]);
                      setShowSearch(false);
                    }}
                  >
                    <X size={16} color={LightColors.textMuted} />
                  </Pressable>
                )}
              </View>

              {/* Search results dropdown */}
              {showSearch && searchResults.length > 0 && (
                <View style={st.searchResults}>
                  {searchResults.map((item, idx) => (
                    <Pressable
                      key={idx}
                      style={st.searchResultItem}
                      onPress={() => handleSearchSelect(item)}
                    >
                      <View style={[st.searchResultDot, { backgroundColor: pinColor + '18' }]}>
                        <View
                          style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: pinColor }}
                        />
                      </View>
                      <Text style={st.searchResultText} numberOfLines={2}>
                        {item.place_name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {/* Empty-state recents — only when the user has focused
                  the search but hasn't typed yet. Helps repeat bookings
                  feel near-instant without ever hitting Mapbox. */}
              {showSearch &&
                searchQuery.trim().length === 0 &&
                recentPlaces.length > 0 && (
                  <View style={st.searchResults}>
                    <Text style={st.recentHeading}>Recent</Text>
                    {recentPlaces.map((item, idx) => (
                      <Pressable
                        key={`recent-${idx}`}
                        style={st.searchResultItem}
                        onPress={() => handleSearchSelect(item)}
                      >
                        <View style={[st.searchResultDot, { backgroundColor: `${LightColors.textMuted}33` }]}>
                          <View
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 3,
                              backgroundColor: LightColors.textTertiary,
                            }}
                          />
                        </View>
                        <Text style={st.searchResultText} numberOfLines={2}>
                          {item.place_name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
            </View>
          )}
        </SafeAreaView>

        {/* No-map hint — fills the space when the map is closed so the
            screen reads as a clean address-entry view, not an empty map
            placeholder waiting for a tap. */}
        {!mapOpen && phase !== 'details' && (
          <View pointerEvents="none" style={st.noMapHint}>
            <View style={st.noMapHintIcon}>
              <MapIcon size={30} color={LightColors.primaryMuted} strokeWidth={1.6} />
            </View>
            <Text style={st.noMapHintTitle}>
              Find your {phase === 'pickup' ? rule.pickupLabel.toLowerCase() : rule.dropoffLabel.toLowerCase()}
            </Text>
            <Text style={st.noMapHintText}>
              Search above, use your current location, or pick a saved place — tap “Map” to drop a pin.
            </Text>
          </View>
        )}

        {/* My location button — only over the map (redundant with the
            sheet's "Current" action when the map is closed). */}
        {mapOpen && phase !== 'details' && (
          <Pressable style={st.myLocationBtn} onPress={handleMyLocation}>
            <Crosshair size={20} color={LightColors.primary} />
          </Pressable>
        )}
      </View>

      {/* ═══ BOTTOM PANEL (expandable sheet) ═══ */}
      <ExpandableSheet
        initial={phase === 'details' ? 'half' : 'peek'}
        snapPoints={{ peek: 0.35, half: 0.60, full: 0.93 }}
        footer={
          phase !== 'details' ? (
            <Button
              title={phase === 'pickup' ? `Confirm ${rule.pickupLabel}` : `Confirm ${rule.dropoffLabel}`}
              onPress={handleConfirmLocation}
              disabled={!currentAddress || isMoving}
              fullWidth
            />
          ) : (
            <View>
              {(errors.pickup || errors.dropoff) && (
                <Text style={st.errorText}>{errors.pickup || errors.dropoff}</Text>
              )}
              <Button title="Continue" onPress={handleContinue} fullWidth />
            </View>
          )
        }
      >
      {phase !== 'details' ? (
        /* ── Pickup / Dropoff card ── */
        <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 }}>
          <Text style={st.cardTitle}>
            {phase === 'pickup' ? `Set ${rule.pickupLabel.toLowerCase()}` : `Set ${rule.dropoffLabel.toLowerCase()}`}
          </Text>

          <View style={st.addressRow}>
            <View style={[st.addressDot, { backgroundColor: pinColor + '18' }]}>
              <View style={[st.addressDotInner, { backgroundColor: pinColor }]} />
            </View>
            <Text style={st.addressText} numberOfLines={2}>
              {isMoving
                ? 'Moving...'
                : currentAddress ||
                  (mapOpen ? 'Move the map to select' : 'Search, use current, or select on map')}
            </Text>
          </View>

          {/* Quick actions */}
          <View style={st.quickActions}>
            <Pressable style={st.quickBtn} onPress={handleMyLocation} accessibilityRole="button" accessibilityLabel="Use current location">
              <Navigation size={14} color={LightColors.primary} />
              <Text style={st.quickBtnText}>Current</Text>
            </Pressable>
            {/* Saved addresses are useful for pickup too — a runner picking up
                from your home or office is the most common pattern. Previously
                this was hidden during pickup, forcing users to type or pan. */}
            <Pressable style={st.quickBtn} onPress={() => setShowSavedSheet(true)} accessibilityRole="button" accessibilityLabel="Choose from saved addresses">
              <Bookmark size={14} color={LightColors.primary} />
              <Text style={st.quickBtnText}>Saved</Text>
            </Pressable>
            {/* Opt-in map — mounts the map only when the user wants pin-drag. */}
            {!mapOpen && (
              <Pressable style={st.quickBtn} onPress={() => setMapOpen(true)} accessibilityRole="button" accessibilityLabel="Select location on map">
                <MapIcon size={14} color={LightColors.primary} />
                <Text style={st.quickBtnText}>Map</Text>
              </Pressable>
            )}
          </View>

          {/* Confirm CTA lives in the sheet `footer` so it stays visible. */}
        </View>
      ) : (
        /* ── Details sheet ── */
        <KeyboardAvoidingView
          style={{ flex: 1, paddingHorizontal: 20, paddingTop: 12 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 140 : 0}
        >
          {/* Route summary strip — tappable to change */}
          <View style={st.routeSummary}>
            <Pressable style={st.routePoint} onPress={() => handleChangeLocation('pickup')}>
              <View style={[st.routeDot, { backgroundColor: LightColors.primary }]} />
              <Text style={st.routeAddr} numberOfLines={1}>
                {draftBooking.pickup_address}
              </Text>
              <Text style={st.changeLink}>Change</Text>
            </Pressable>
            {!rule.singleLocation && (
              <>
                {/* Dashed connector between the pickup/dropoff beads —
                    matches the trip-timeline language used elsewhere. */}
                <View style={st.routeConnector}>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <View key={i} style={st.routeConnectorDash} />
                  ))}
                </View>
                <Pressable style={st.routePoint} onPress={() => handleChangeLocation('dropoff')}>
                  <View style={[st.routeDot, { backgroundColor: LightColors.danger }]} />
                  <Text style={st.routeAddr} numberOfLines={1}>
                    {draftBooking.dropoff_address}
                  </Text>
                  <Text style={st.changeLink}>Change</Text>
                </Pressable>
              </>
            )}
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 100 }}
            keyboardShouldPersistTaps="handled"
            // iOS-only: lets the ScrollView add its own inset when the
            // keyboard appears so a focused TextInput auto-scrolls into
            // view even if the surrounding KAV offset undershoots.
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          >
            {rule.helperNote && (
              <View style={st.helperNote}>
                <Text style={st.helperNoteText}>{rule.helperNote}</Text>
              </View>
            )}
            {rule.showDescription && (
              <Input
                label={`${rule.descriptionLabel}${rule.descriptionRequired ? ' *' : ''}`}
                value={draftBooking.description ?? ''}
                onChangeText={(v) => {
                  updateDraft({ description: v });
                  if (errors.description && v.trim()) {
                    setErrors((e) => ({ ...e, description: '' }));
                  }
                }}
                placeholder={rule.descriptionPlaceholder}
                multiline
                numberOfLines={3}
                maxLength={500}
                error={errors.description}
              />
            )}
            <Input
              label="Special Instructions (optional)"
              value={draftBooking.special_instructions ?? ''}
              onChangeText={(v) => updateDraft({ special_instructions: v })}
              placeholder="Any special notes..."
              multiline
              numberOfLines={2}
              maxLength={300}
            />

            {rule.showPhotos && (
              <PhotoGrid
                photos={photos}
                maxPhotos={5}
                onAdd={handleAddPhoto}
                onRemove={handleRemovePhoto}
              />
            )}

            {rule.showItemValue && (
              <Input
                label="Estimated Item Value (optional)"
                value={
                  draftBooking.estimated_item_value != null
                    ? String(draftBooking.estimated_item_value)
                    : ''
                }
                onChangeText={(v) => {
                  const num = parseFloat(v);
                  updateDraft({ estimated_item_value: isNaN(num) ? undefined : num });
                }}
                placeholder="₱0.00"
                keyboardType="numeric"
              />
            )}

            {rule.requiresShoppingBudget && (
              <Input
                label="Shopping Budget *"
                value={
                  draftBooking.shopping_budget != null
                    ? String(draftBooking.shopping_budget)
                    : ''
                }
                onChangeText={(v) => {
                  const num = parseFloat(v);
                  updateDraft({ shopping_budget: isNaN(num) ? undefined : num });
                  if (errors.shopping_budget && !isNaN(num) && num > 0) {
                    setErrors((e) => ({ ...e, shopping_budget: '' }));
                  }
                }}
                placeholder="₱ Maximum amount the runner may spend"
                keyboardType="numeric"
                error={errors.shopping_budget}
              />
            )}

            {/* Pickup contact */}
            {rule.showPickupContact && (
              <>
                <Pressable
                  style={st.contactToggle}
                  onPress={() => setShowPickupContact(!showPickupContact)}
                >
                  <UserPlus size={14} color={LightColors.primary} />
                  <Text style={st.contactToggleText}>
                    {showPickupContact ? 'Hide' : 'Add'} {rule.pickupLabel.toLowerCase()} contact
                  </Text>
                  {showPickupContact ? (
                    <ChevronUp size={14} color={LightColors.primary} />
                  ) : (
                    <ChevronDown size={14} color={LightColors.primary} />
                  )}
                </Pressable>
                {showPickupContact && (
                  <>
                    <Input
                      label="Contact Name"
                      value={draftBooking.pickup_contact_name ?? ''}
                      onChangeText={(v) => updateDraft({ pickup_contact_name: v })}
                      placeholder={`Person at ${rule.pickupLabel.toLowerCase()}`}
                    />
                    <Input
                      label="Contact Phone"
                      value={draftBooking.pickup_contact_phone ?? ''}
                      onChangeText={(v) => updateDraft({ pickup_contact_phone: v.replace(/[^0-9+]/g, '').slice(0, 13) })}
                      placeholder="e.g. 09171234567"
                      keyboardType="phone-pad"
                      maxLength={13}
                    />
                  </>
                )}
              </>
            )}

            {/* Dropoff contact */}
            {rule.showDropoffContact && (
              <>
                <Pressable
                  style={st.contactToggle}
                  onPress={() => setShowDropoffContact(!showDropoffContact)}
                >
                  <UserPlus size={14} color={LightColors.primary} />
                  <Text style={st.contactToggleText}>
                    {showDropoffContact ? 'Hide' : 'Add'} {rule.dropoffLabel.toLowerCase()} contact
                  </Text>
                  {showDropoffContact ? (
                    <ChevronUp size={14} color={LightColors.primary} />
                  ) : (
                    <ChevronDown size={14} color={LightColors.primary} />
                  )}
                </Pressable>
                {showDropoffContact && (
                  <>
                    <Input
                      label="Contact Name"
                      value={draftBooking.dropoff_contact_name ?? ''}
                      onChangeText={(v) => updateDraft({ dropoff_contact_name: v })}
                      placeholder={`Person at ${rule.dropoffLabel.toLowerCase()}`}
                    />
                    <Input
                      label="Contact Phone"
                      value={draftBooking.dropoff_contact_phone ?? ''}
                      onChangeText={(v) => updateDraft({ dropoff_contact_phone: v.replace(/[^0-9+]/g, '').slice(0, 13) })}
                      placeholder="e.g. 09171234567"
                      keyboardType="phone-pad"
                      maxLength={13}
                    />
                  </>
                )}
              </>
            )}
          </ScrollView>

          {/* Continue CTA lives in the sheet `footer` so it stays visible
              regardless of keyboard / scroll position. */}
        </KeyboardAvoidingView>
      )}
      </ExpandableSheet>

      {/* Saved Address Sheet */}
      <SavedAddressSheet
        isVisible={showSavedSheet}
        onClose={() => setShowSavedSheet(false)}
        onSelect={handleSavedAddressSelect}
      />

      {/* Image Picker Modal */}
      <ImagePickerModal
        visible={photoPickerVisible}
        onClose={() => setPhotoPickerVisible(false)}
        onConfirm={handlePhotoConfirm}
        title="Add Item Photo"
        subtitle="Help the runner identify your item"
      />
    </View>
  );
}

/* ─── Styles ─── */

const st = StyleSheet.create({
  centerPinWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  stepIndicatorBackdrop: {
    marginTop: 10,
    marginHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: LightColors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: LightColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: LightColors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  headerPills: {
    flexDirection: 'row',
    marginLeft: 12,
    gap: 6,
    // Retained for compatibility with any external snapshots; visually unused.
  },
  pill: { width: 0, height: 0 },
  pillActive: {},
  pillInactive: {},
  pillText: {},
  pillTextActive: {},
  phaseTitle: {
    fontSize: 16,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textPrimary,
    marginLeft: 12,
  },
  searchWrap: {
    paddingHorizontal: 16,
    marginTop: 12,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LightColors.surface,
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 48,
    shadowColor: LightColors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textPrimary,
    marginLeft: 10,
  },
  searchResults: {
    backgroundColor: LightColors.surface,
    borderRadius: 16,
    marginTop: 6,
    shadowColor: LightColors.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
    overflow: 'hidden',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: LightColors.divider,
  },
  searchResultDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  searchResultText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textPrimary,
  },
  recentHeading: {
    fontSize: 11,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  myLocationBtn: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: LightColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: LightColors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  noMapHint: {
    position: 'absolute',
    top: 190,
    left: 32,
    right: 32,
    alignItems: 'center',
  },
  noMapHintIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: LightColors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  noMapHintTitle: {
    fontSize: 16,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textPrimary,
    marginBottom: 6,
    textAlign: 'center',
  },
  noMapHintText: {
    fontSize: 13,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  closeMapBtn: {
    position: 'absolute',
    right: 16,
    top: 120,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: LightColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: LightColors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  bottomCard: {
    backgroundColor: LightColors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    shadowColor: LightColors.ink,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: LightColors.divider,
    alignSelf: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 17,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textPrimary,
    marginBottom: 14,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  addressDot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  addressDotInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  addressText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textPrimary,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
  },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LightColors.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  quickBtnText: {
    fontSize: 12,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.primary,
    marginLeft: 6,
  },
  detailsSheet: {
    flex: 1,
    backgroundColor: LightColors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    marginTop: -16,
    shadowColor: LightColors.ink,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
  routeSummary: {
    paddingVertical: 14,
    marginBottom: 4,
  },
  routePoint: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  routeAddr: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textPrimary,
  },
  changeLink: {
    fontSize: 11,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.primary,
    marginLeft: 8,
  },
  routeConnector: {
    width: 2,
    height: 24,
    marginLeft: 4,
    marginVertical: 4,
    justifyContent: 'space-between',
  },
  routeConnectorDash: {
    width: 2,
    height: 5,
    borderRadius: 1,
    backgroundColor: LightColors.dividerStrong,
  },
  contactToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  helperNote: {
    backgroundColor: LightColors.primaryLight,
    borderRadius: 16,
    padding: 12,
    marginBottom: 14,
  },
  helperNoteText: {
    fontSize: 12,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.primaryDark,
    lineHeight: 17,
  },
  contactToggleText: {
    fontSize: 12,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.primary,
    marginLeft: 6,
    marginRight: 2,
  },
  continueCta: {
    paddingVertical: 12,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: LightColors.divider,
  },
  errorText: {
    fontSize: 12,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.danger,
    marginBottom: 8,
  },
});
