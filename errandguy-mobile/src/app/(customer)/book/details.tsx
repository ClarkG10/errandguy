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
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft,
  Search,
  X,
  Navigation,
  Bookmark,
  ChevronDown,
  ChevronUp,
  UserPlus,
  MessageSquarePlus,
  Crosshair,
} from 'lucide-react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { HereMapView, HereMarker, HerePolyline, type HereMapViewRef, type Region } from '../../../components/map';
import * as Location from 'expo-location';
import { ensureLocationPermission, getCurrentCoords } from '../../../utils/locationPermission';
import { useBookingStore } from '../../../stores/bookingStore';
import { useImagePicker } from '../../../hooks/useImagePicker';
import { useDebounce } from '../../../hooks/useDebounce';
import { Button } from '../../../components/ui/Button';
import { Spinner } from '../../../components/ui/Spinner';
import { Input, type InputHandle } from '../../../components/ui/Input';
import { KeyboardDockInput } from '../../../components/ui/KeyboardDockInput';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { PhotoGrid } from '../../../components/customer/PhotoGrid';
import { ImagePickerModal } from '../../../components/ui/ImagePickerModal';
import { SavedAddressSheet } from '../../../components/customer/SavedAddressSheet';
import { ShoppingChecklist } from '../../../components/customer/ShoppingChecklist';
import { ExpandableSheet } from '../../../components/ui/ExpandableSheet';
import { BookingStepIndicator } from '../../../components/customer/BookingStepIndicator';

import { getErrandTypeRule } from '../../../constants/errandTypeRules';
import { LightColors, Elevation } from '../../../constants/colors';
import { useResponsive } from '../../../constants/responsive';
import type { SavedAddress } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { geocodingService } from '../../../services/geocoding.service';
import { routeService } from '../../../services/route.service';
import { bookingService } from '../../../services/booking.service';

const DEFAULT_CENTER: [number, number] = [121.0, 14.6];
// Step labels live in `BookingStepIndicator`; keep this file lean.

/* ─── Animated Pulse Marker (frozen pins) ─── */

function PulseMarker({ color }: { color: string }) {
  const reduceMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Reduce Motion: keep the halo as a static ring so the pin retains
    // its visual weight without the perpetual pulse.
    if (reduceMotion) {
      pulse.setValue(0);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [reduceMotion, pulse]);
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: 56, height: 56 }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: color,
          opacity: reduceMotion
            ? 0.18
            : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
          transform: reduceMotion
            ? undefined
            : [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.4] }) }],
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
  const insets = useSafeAreaInsets();
  const { mScale, contentMaxWidth } = useResponsive();

  // Sheet snaps in real device terms rather than blind fractions:
  //  • peek must fit the location card PLUS the sticky footer — a fixed
  //    0.35 clipped the quick-action chips behind the footer on 640dp
  //    Androids and the SE;
  //  • full must stop just below the floating back row, or the sheet
  //    covers the only back affordance (59pt Dynamic Island insets made
  //    a fixed 0.93 swallow it entirely).
  const footerHeight = 58 + Math.max(insets.bottom, 12);
  const sheetSnapPoints = useMemo(
    () => ({
      peek: Math.min(0.5, (184 + footerHeight) / SCREEN_HEIGHT),
      half: 0.6,
      full: Math.min(0.93, 1 - (insets.top + 56) / SCREEN_HEIGHT),
    }),
    [SCREEN_HEIGHT, footerHeight, insets.top],
  );

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

  // P1: warm the fare estimate the instant we reach the details phase — i.e. as
  // soon as errand_type_id + pickup + dropoff coords are all finalized (covers
  // the pickup/dropoff confirm flip, the initial-details rebook path, and
  // returning to details after changing a location). Review then paints the
  // fare and enables Confirm on its first frame instead of firing the POST on
  // its own mount and gating the CTA on the round-trip. Fire-and-forget; the
  // signature-keyed stash + in-flight dedupe collapse any double-POST.
  useEffect(() => {
    if (phase !== 'details') return;
    if (
      !draftBooking.errand_type_id ||
      draftBooking.pickup_lat == null ||
      draftBooking.pickup_lng == null
    ) {
      return;
    }
    bookingService.prefetchEstimate({
      errand_type_id: draftBooking.errand_type_id,
      pickup_lat: draftBooking.pickup_lat,
      pickup_lng: draftBooking.pickup_lng,
      dropoff_lat: draftBooking.dropoff_lat,
      dropoff_lng: draftBooking.dropoff_lng,
    });
  }, [
    phase,
    draftBooking.errand_type_id,
    draftBooking.pickup_lat,
    draftBooking.pickup_lng,
    draftBooking.dropoff_lat,
    draftBooking.dropoff_lng,
  ]);

  const mapOpen = true;
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
  // Tracks whether the most recent search request has completed — lets
  // us tell "still searching" apart from "searched, found nothing".
  const [searchDone, setSearchDone] = useState(false);
  // True when the search request itself failed (network down, etc.).
  const [searchFailed, setSearchFailed] = useState(false);
  // Bumped by the tappable failure row to re-fire the same query.
  const [searchNonce, setSearchNonce] = useState(0);
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
  // Mirror for the undo toast — its onAction can fire seconds later, after
  // the removal-time closure has gone stale.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  const [showPickupContact, setShowPickupContact] = useState(
    !!(draftBooking.pickup_contact_name || draftBooking.pickup_contact_phone),
  );
  const [showDropoffContact, setShowDropoffContact] = useState(
    !!(draftBooking.dropoff_contact_name || draftBooking.dropoff_contact_phone),
  );
  // When the errand type already renders an optional notes-style
  // description field, a second always-on notes box is redundant —
  // collapse Special Instructions behind an "+ Add" toggle instead.
  const collapseSpecialInstructions =
    !rule.requiresShoppingBudget && rule.showDescription && !rule.descriptionRequired;
  const [showSpecialInstructions, setShowSpecialInstructions] = useState(
    !!draftBooking.special_instructions,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Currency fields keep the raw typed text locally and parse one-way
  // into the draft — a parseFloat round-trip would eat the decimal
  // point mid-entry ("150." → "150") and corrupt the amount.
  const [budgetText, setBudgetText] = useState(() =>
    draftBooking.shopping_budget != null ? String(draftBooking.shopping_budget) : '',
  );
  const [itemValueText, setItemValueText] = useState(() =>
    draftBooking.estimated_item_value != null ? String(draftBooking.estimated_item_value) : '',
  );

  // Digits and at most one decimal point.
  const sanitizeAmount = (v: string) => {
    const clean = v.replace(/[^0-9.]/g, '');
    const parts = clean.split('.');
    return parts.length > 1 ? `${parts[0]}.${parts.slice(1).join('')}` : clean;
  };

  // Currency values render in Inter + tabular-nums (the numeric family).
  // Passing `style` replaces Input's internal TextInput style entirely,
  // so the layout-critical pieces are restated here.
  const amountInputStyle = {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: mScale(15),
    color: LightColors.textPrimary,
    paddingVertical: 0,
    fontVariant: ['tabular-nums' as const],
  };

  // Scroll-to-error wayfinding: section offsets captured via onLayout,
  // plus imperative focus for the focusable fields.
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Record<string, number>>({});
  const descriptionRef = useRef<InputHandle>(null);
  const budgetRef = useRef<InputHandle>(null);
  const pickupPhoneRef = useRef<InputHandle>(null);
  const dropoffPhoneRef = useRef<InputHandle>(null);

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
      setItemValueText('');
    }
    if (!rule.requiresShoppingBudget && draftBooking.shopping_budget != null) {
      patch.shopping_budget = undefined;
      setBudgetText('');
    }
    if (!rule.requiresShoppingBudget && (draftBooking.shoppingItems?.length ?? 0) > 0) {
      patch.shoppingItems = undefined;
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
  // Route preview failed to load — purely informational (the booking can
  // proceed without a polyline), surfaced as a dismissible chip.
  const [routePreviewFailed, setRoutePreviewFailed] = useState(false);

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
      setSearchDone(false);
      setSearchFailed(false);
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
    setSearchDone(false);
    setSearchFailed(false);
    geocodingService
      .search(debouncedSearch, 8, undefined, proximity)
      .then((features) => {
        if (cancelled) return;
        setSearchResults(features);
        setSearchDone(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSearchResults([]);
        setSearchDone(true);
        setSearchFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // currentCoord/userLocation/phase intentionally read fresh — the bias
    // should track wherever the user has the map right now, but we don't
    // want to spam Mapbox on every pin nudge, so we still only fire when
    // the *query* changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, searchNonce]);

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
      // Likewise when the dropoff is already confirmed (user came back via
      // "Change" on the pickup): jump straight back to the form instead of
      // making them re-confirm the untouched dropoff.
      if (rule.singleLocation || draftBooking.dropoff_lat != null) {
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
  }, [phase, currentCoord, currentAddress, updateDraft, rule.singleLocation, draftBooking.dropoff_lat]);

  /* ── Back ── */
  const handleBack = useCallback(() => {
    if (phase === 'pickup') {
      // Leaving the booking-details flow — keep the confirmed locations in
      // the draft. The persisted draft + initialPhase fast-forward restore
      // them on re-entry, and the 24h draft expiry covers staleness.
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
        // Go back to pickup mode, clear ONLY the pickup draft — the
        // confirmed dropoff stays untouched, so confirming the new pickup
        // jumps straight back to the details form.
        updateDraft({
          pickup_address: undefined,
          pickup_lat: undefined,
          pickup_lng: undefined,
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
    if (phase !== 'details') return;
    if (!draftBooking.pickup_lat || !draftBooking.dropoff_lat) return;
    let cancelled = false;
    routeService
      .getRoute(
        { lng: Number(draftBooking.pickup_lng), lat: Number(draftBooking.pickup_lat) },
        { lng: Number(draftBooking.dropoff_lng), lat: Number(draftBooking.dropoff_lat) },
      )
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          // Preview couldn't be built — tell the user quietly instead of
          // silently showing a route-less map. Booking proceeds regardless.
          setRoutePreviewFailed(true);
          return;
        }
        setRoutePreviewFailed(false);
        setRouteCoords(res.coordinates);
      })
      .catch(() => {
        if (!cancelled) setRoutePreviewFailed(true);
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
        {
          // The map view is full-screen but the sheet rests at `half`
          // during the details phase — pad the bottom by the covered
          // band and the top by the floating back row, or the route
          // gets framed dead-center and mostly hidden under the sheet.
          edgePadding: {
            top: insets.top + 72,
            bottom: SCREEN_HEIGHT * 0.6 + 24,
            left: 60,
            right: 60,
          },
          animated: true,
        },
      );
    }, 300);
    return () => clearTimeout(t);
  }, [phase, insets.top, SCREEN_HEIGHT, draftBooking.pickup_lat, draftBooking.pickup_lng, draftBooking.dropoff_lat, draftBooking.dropoff_lng]);

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
      const removed = photos[index];
      if (removed == null) return;
      const updated = photos.filter((_, i) => i !== index);
      setPhotos(updated);
      updateDraft({ item_photos: updated });
      // Undo beats a confirm dialog for a cheap, reversible action —
      // re-staging a camera shot is the expensive path.
      toast.info('Photo removed', {
        actionLabel: 'Undo',
        onAction: () => {
          const next = [...photosRef.current];
          next.splice(Math.min(index, next.length), 0, removed);
          setPhotos(next);
          updateDraft({ item_photos: next });
        },
      });
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
    if (rule.requiresShoppingBudget) {
      // Shopping types use the checklist in place of the free-text
      // description, so validate the list instead.
      if (!draftBooking.shoppingItems?.some((it) => it.name.trim())) {
        newErrors.shoppingItems = 'Add at least one item to your list';
      }
      const budget = draftBooking.shopping_budget;
      if (budget == null || budget <= 0) {
        newErrors.shopping_budget = 'Shopping budget is required';
      }
    } else if (rule.descriptionRequired && !draftBooking.description?.trim()) {
      newErrors.description = `${rule.descriptionLabel} is required`;
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      // Bring the first offending section into view — on a form this long
      // it's usually scrolled off-screen when Continue is tapped.
      // (pickup/dropoff errors render in the always-visible footer.)
      const firstKey = (['shoppingItems', 'description', 'shopping_budget'] as const).find(
        (k) => newErrors[k],
      );
      if (firstKey) {
        const y = sectionY.current[firstKey];
        if (y != null) {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
        }
        if (firstKey === 'description') descriptionRef.current?.focus();
        if (firstKey === 'shopping_budget') budgetRef.current?.focus();
      }
      return;
    }
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
        // Auto-detect the pickup at START for convenience, but without ever
        // popping a dialog on screen load: getCurrentCoords with
        // requirePermission:false returns a fix ONLY if location is already
        // granted (typically from the onboarding primer), and it races a
        // last-known seed against an 8s timeout so it never hangs on weak
        // GPS / a simulator — the old raw getCurrentPositionAsync had no
        // timeout, which is why current location often appeared "stuck".
        // If permission isn't granted we keep the default center; the
        // "Current" button prompts on demand.
        const pos = await getCurrentCoords({
          requirePermission: true,
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled || !pos) return;
        const coord: [number, number] = [pos.lng, pos.lat];
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
      {/* ═══ MAP (always mounted) ═══ */}
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
              // Centered halo dot, not a bottom-tipped pin — anchor at the
              // middle or the dot floats ~28pt north of the real spot.
              anchor={{ x: 0.5, y: 0.5 }}
              id="pickup-marker"
            >
              <PulseMarker color={LightColors.primary} />
            </HereMarker>
          )}

          {/* Frozen dropoff marker */}
          {phase === 'details' && draftBooking.dropoff_lng != null && draftBooking.dropoff_lat != null && (
            <HereMarker
              coordinate={{ latitude: draftBooking.dropoff_lat, longitude: draftBooking.dropoff_lng }}
              anchor={{ x: 0.5, y: 0.5 }}
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

        {/* Route-preview failure chip — dismissible, non-blocking. */}
        {mapOpen && phase === 'details' && routePreviewFailed && (
          <View style={[st.routeErrorWrap, { top: insets.top + 64 }]} pointerEvents="box-none">
            <View style={st.routeErrorChip}>
              <Text style={st.routeErrorText}>Couldn't preview route</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss route preview notice"
                hitSlop={12}
                onPress={() => setRoutePreviewFailed(false)}
              >
                <X size={14} color={LightColors.textInverse} />
              </Pressable>
            </View>
          </View>
        )}

        {/* ── Floating header ── */}
        <SafeAreaView style={st.floatingHeader} edges={['top']} pointerEvents="box-none">
          <View style={st.headerRow}>
            <Pressable
              onPress={handleBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={8}
              style={({ pressed }) => [st.backBtn, pressed && { opacity: 0.7 }]}
            >
              <ChevronLeft size={20} color={LightColors.textPrimary} strokeWidth={2.2} />
            </Pressable>
            {/* Surface pill — bare text over satellite/dark tiles was
                unreadable; the pill matches the back button's chrome. */}
            <View style={st.phaseTitlePill}>
              <Text style={st.phaseTitle}>
                {phase === 'pickup' ? 'Set pickup' : phase === 'dropoff' ? 'Set dropoff' : 'Add details'}
              </Text>
            </View>
          </View>

          {/* Step indicator pinned under the back row — sits in a soft
              translucent card so it stays legible whether the map below
              is in dark park, light city, or satellite mode. During the
              details phase it lives INSIDE the sheet instead — the
              full-height sheet would cover this floating copy. */}
          {phase !== 'details' && (
            // +32 = the card's own 16px side margins, so its outer edges
            // land exactly on the clamped content column on tablets.
            <View style={{ width: '100%', maxWidth: contentMaxWidth + 32, alignSelf: 'center' }}>
              <View style={st.stepIndicatorBackdrop}>
                {/* Pickup/dropoff/details are all sub-phases of step 2 — the
                    indicator must never regress below where the user came from. */}
                <Text style={st.stepEyebrow}>New errand · Step 2</Text>
                <BookingStepIndicator currentStep={1} />
              </View>
            </View>
          )}

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
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    hitSlop={14}
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

              {/* In-flight row — replaces stale results so a slow network
                  reads as "working", not "broken". */}
              {showSearch && !searchDone && searchQuery.trim().length >= 2 && (
                <View style={st.searchResults}>
                  <View style={[st.searchResultItem, st.searchResultItemLast]}>
                    <Spinner size="small" color={LightColors.primary} />
                    <Text style={[st.searchEmptyText, { marginLeft: 10 }]}>Searching…</Text>
                  </View>
                </View>
              )}

              {/* Search results dropdown — height-capped and scrollable:
                  8 rows would otherwise run under the keyboard on an SE
                  with no way to reach the bottom half. */}
              {showSearch && searchDone && searchResults.length > 0 && (
                <View style={st.searchResults}>
                  <ScrollView
                    style={{ maxHeight: SCREEN_HEIGHT * 0.28 }}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                  >
                    {searchResults.map((item, idx) => (
                      <Pressable
                        key={idx}
                        accessibilityRole="button"
                        accessibilityLabel={item.place_name}
                        style={({ pressed }) => [
                          st.searchResultItem,
                          idx === searchResults.length - 1 && st.searchResultItemLast,
                          pressed && { backgroundColor: LightColors.surfaceMuted },
                        ]}
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
                  </ScrollView>
                </View>
              )}

              {/* Completed search, zero hits — previously the dropdown
                  just disappeared silently, reading as a broken search. */}
              {showSearch &&
                searchDone &&
                searchResults.length === 0 &&
                searchQuery.trim().length >= 2 && (
                  <View style={st.searchResults}>
                    {searchFailed ? (
                      <Pressable
                        style={({ pressed }) => [
                          st.searchResultItem,
                          st.searchResultItemLast,
                          pressed && { backgroundColor: LightColors.surfaceMuted },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Search unavailable. Retry search"
                        onPress={() => {
                          setSearchDone(false);
                          setSearchNonce((n) => n + 1);
                        }}
                      >
                        <Text style={st.searchEmptyText}>
                          Search unavailable — tap to retry
                        </Text>
                      </Pressable>
                    ) : (
                      <View style={[st.searchResultItem, st.searchResultItemLast]}>
                        <Text style={st.searchEmptyText}>
                          {`No places found for “${searchQuery.trim()}”`}
                        </Text>
                      </View>
                    )}
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
                    <ScrollView
                      style={{ maxHeight: SCREEN_HEIGHT * 0.28 }}
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled
                    >
                      {recentPlaces.map((item, idx) => (
                        <Pressable
                          key={`recent-${idx}`}
                          accessibilityRole="button"
                          accessibilityLabel={item.place_name}
                          style={({ pressed }) => [
                            st.searchResultItem,
                            idx === recentPlaces.length - 1 && st.searchResultItemLast,
                            pressed && { backgroundColor: LightColors.surfaceMuted },
                          ]}
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
                    </ScrollView>
                  </View>
                )}
            </View>
          )}
        </SafeAreaView>

        {/* My location button — floats over the map during pickup/dropoff phases. */}
        {phase !== 'details' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Center map on my location"
            // The map pane spans the whole screen behind the sheet — a
            // fixed bottom:16 buried this under the sheet + footer.
            style={({ pressed }) => [
              st.myLocationBtn,
              { bottom: SCREEN_HEIGHT * sheetSnapPoints.peek + 12 },
              pressed && { opacity: 0.7 },
            ]}
            onPress={handleMyLocation}
          >
            <Crosshair size={20} color={LightColors.primary} />
          </Pressable>
        )}
      </View>

      {/* ═══ BOTTOM PANEL (expandable sheet) ═══ */}
      <ExpandableSheet
        initial={phase !== 'details' ? 'peek' : 'half'}
        snapPoints={sheetSnapPoints}
        footer={
          // Clamp on tablets so the CTA doesn't stretch edge-to-edge on iPad.
          <View style={{ width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' }}>
            {phase !== 'details' ? (
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
            )}
          </View>
        }
      >
      {phase !== 'details' ? (
        /* ── Pickup / Dropoff card ── */
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: 32,
            width: '100%',
            maxWidth: contentMaxWidth,
            alignSelf: 'center',
          }}
        >
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
                  'Move the map to select'}
            </Text>
          </View>

          {/* Quick actions */}
          <View style={st.quickActions}>
            <Pressable
              // Layout via className — NativeWind was dropping flexDirection/
              // background from the old `style={() => [st.quickBtn]}` function
              // (no className present), which stacked the icon above the label
              // and hid the pill fill. className applies reliably.
              className="flex-1 flex-row items-center justify-center bg-primaryLight rounded-xl px-2.5 py-2.5"
              style={({ pressed }) => (pressed ? st.quickBtnPressed : null)}
              hitSlop={8}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                handleMyLocation();
              }}
              accessibilityRole="button"
              accessibilityLabel="Use current location"
            >
              <Navigation size={14} color={LightColors.primary} />
              <Text style={st.quickBtnText} numberOfLines={1}>Current</Text>
            </Pressable>
            {/* Saved addresses are useful for pickup too — a runner picking up
                from your home or office is the most common pattern. Previously
                this was hidden during pickup, forcing users to type or pan. */}
            <Pressable
              // Layout via className — NativeWind was dropping flexDirection/
              // background from the old `style={() => [st.quickBtn]}` function
              // (no className present), which stacked the icon above the label
              // and hid the pill fill. className applies reliably.
              className="flex-1 flex-row items-center justify-center bg-primaryLight rounded-xl px-2.5 py-2.5"
              style={({ pressed }) => (pressed ? st.quickBtnPressed : null)}
              hitSlop={8}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setShowSavedSheet(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Choose from saved addresses"
            >
              <Bookmark size={14} color={LightColors.primary} />
              <Text style={st.quickBtnText} numberOfLines={1}>Saved</Text>
            </Pressable>
          </View>

          {/* Confirm CTA lives in the sheet `footer` so it stays visible. */}
        </View>
      ) : (
        /* ── Details sheet ──
            No KeyboardAvoidingView here on purpose: the ScrollView's
            `automaticallyAdjustKeyboardInsets` handles iOS, and Android
            resizes the window (`softwareKeyboardLayoutMode: resize`).
            A KAV inside this translated sheet measured its frame in the
            wrong coordinate space and double-compensated on both. */
        <View
          style={{
            flex: 1,
            paddingHorizontal: 20,
            paddingTop: 12,
            width: '100%',
            maxWidth: contentMaxWidth,
            alignSelf: 'center',
          }}
        >
          {/* In-sheet step indicator — the floating copy over the map is
              hidden this phase because the full-height sheet covers it. */}
          <View style={st.sheetStepHeader}>
            <Text style={st.stepEyebrow}>New errand · Step 2</Text>
            <BookingStepIndicator currentStep={1} />
          </View>

          {/* Route summary strip — tappable to change */}
          <View style={st.routeSummary}>
            <Pressable
              style={st.routePoint}
              onPress={() => handleChangeLocation('pickup')}
              accessibilityRole="button"
              accessibilityLabel={`Change ${rule.pickupLabel}: ${draftBooking.pickup_address ?? ''}`}
            >
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
                <Pressable
                  style={st.routePoint}
                  onPress={() => handleChangeLocation('dropoff')}
                  accessibilityRole="button"
                  accessibilityLabel={`Change ${rule.dropoffLabel}: ${draftBooking.dropoff_address ?? ''}`}
                >
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
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            // The sheet reserves the footer's height below this ScrollView;
            // this is extra scroll runway on top of that. Bumped 32 → 72 so
            // the last rows — the "Add pickup/drop-off contact" toggles that
            // sit at the very bottom of the form — always scroll fully clear
            // of the sticky Continue footer instead of hiding beneath it.
            contentContainerStyle={{ paddingBottom: 72 }}
            keyboardShouldPersistTaps="handled"
            // Scrolling toward the sticky Continue also dismisses the
            // keyboard — the only other dismissal path is tapping a blank
            // spot, which barely exists on this form.
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            // iOS: the ScrollView insets itself under the keyboard and
            // auto-scrolls the focused TextInput into view. Android is
            // covered by the window resize.
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          >
            {rule.helperNote && (
              <View style={st.helperNote}>
                <Text style={st.helperNoteText}>{rule.helperNote}</Text>
              </View>
            )}
            {/* Shopping types (grocery / food / purchase / bills) build a
                structured checklist instead of a free-text description —
                it's serialized into `description` at submit. */}
            {rule.requiresShoppingBudget ? (
              <View
                onLayout={(e) => {
                  sectionY.current.shoppingItems = e.nativeEvent.layout.y;
                }}
              >
                <ShoppingChecklist
                  title={rule.descriptionLabel}
                  value={draftBooking.shoppingItems ?? []}
                  onChange={(items) => {
                    updateDraft({ shoppingItems: items });
                    if (errors.shoppingItems && items.some((it) => it.name.trim())) {
                      setErrors((e) => ({ ...e, shoppingItems: '' }));
                    }
                  }}
                  onRemoveItem={(item, index) => {
                    // Blank rows aren't worth an undo — only typed names.
                    if (!item.name.trim()) return;
                    toast.info('Item removed', {
                      actionLabel: 'Undo',
                      onAction: () => {
                        const items =
                          useBookingStore.getState().draftBooking.shoppingItems ?? [];
                        const next = [...items];
                        next.splice(Math.min(index, next.length), 0, item);
                        updateDraft({ shoppingItems: next });
                        setErrors((e) =>
                          e.shoppingItems ? { ...e, shoppingItems: '' } : e,
                        );
                      },
                    });
                  }}
                  error={errors.shoppingItems}
                />
              </View>
            ) : (
              rule.showDescription && (
                <View
                  onLayout={(e) => {
                    sectionY.current.description = e.nativeEvent.layout.y;
                  }}
                >
                  <Input
                    ref={descriptionRef}
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
                </View>
              )
            )}
            {collapseSpecialInstructions && !showSpecialInstructions ? (
              <Pressable
                style={st.contactToggle}
                hitSlop={8}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setShowSpecialInstructions(true);
                }}
                accessibilityRole="button"
                accessibilityState={{ expanded: false }}
              >
                <MessageSquarePlus size={14} color={LightColors.primary} />
                <Text style={st.contactToggleText}>Add special instructions</Text>
                <ChevronDown size={14} color={LightColors.primary} />
              </Pressable>
            ) : (
              <>
                {collapseSpecialInstructions && (
                  <Pressable
                    style={st.contactToggle}
                    hitSlop={8}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      setShowSpecialInstructions(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: true }}
                  >
                    <MessageSquarePlus size={14} color={LightColors.primary} />
                    <Text style={st.contactToggleText}>Hide special instructions</Text>
                    <ChevronUp size={14} color={LightColors.primary} />
                  </Pressable>
                )}
                {/* Docks a big, focused editor above the keyboard so long notes
                    aren't cramped behind it (Messenger-style). See KeyboardDockInput. */}
                <KeyboardDockInput
                  label="Special Instructions (optional)"
                  value={draftBooking.special_instructions ?? ''}
                  onChangeText={(v) => updateDraft({ special_instructions: v })}
                  placeholder="Any special notes..."
                  multiline
                  maxLength={300}
                  chips={[
                    'Leave at the gate',
                    'Call on arrival',
                    'Hand to me directly',
                    'Fragile — handle with care',
                    'Leave with guard',
                  ]}
                />
              </>
            )}

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
                value={itemValueText}
                onChangeText={(v) => {
                  const clean = sanitizeAmount(v);
                  setItemValueText(clean);
                  const num = parseFloat(clean);
                  updateDraft({ estimated_item_value: isNaN(num) ? undefined : num });
                }}
                placeholder="₱0.00"
                keyboardType="decimal-pad"
                style={amountInputStyle}
              />
            )}

            {rule.requiresShoppingBudget && (
              <View
                onLayout={(e) => {
                  sectionY.current.shopping_budget = e.nativeEvent.layout.y;
                }}
              >
                <Input
                  ref={budgetRef}
                  label="Shopping Budget *"
                  value={budgetText}
                  onChangeText={(v) => {
                    const clean = sanitizeAmount(v);
                    setBudgetText(clean);
                    const num = parseFloat(clean);
                    updateDraft({ shopping_budget: isNaN(num) ? undefined : num });
                    if (errors.shopping_budget && !isNaN(num) && num > 0) {
                      setErrors((e) => ({ ...e, shopping_budget: '' }));
                    }
                  }}
                  placeholder="₱0.00"
                  keyboardType="decimal-pad"
                  helperText="Maximum amount the runner may spend"
                  error={errors.shopping_budget}
                  style={amountInputStyle}
                />
              </View>
            )}

            {/* Pickup contact */}
            {rule.showPickupContact && (
              <>
                <Pressable
                  style={st.contactToggle}
                  hitSlop={8}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setShowPickupContact(!showPickupContact);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showPickupContact }}
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
                      autoComplete="name"
                      textContentType="name"
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => pickupPhoneRef.current?.focus()}
                    />
                    <Input
                      ref={pickupPhoneRef}
                      label="Contact Phone"
                      value={draftBooking.pickup_contact_phone ?? ''}
                      onChangeText={(v) => updateDraft({ pickup_contact_phone: v.replace(/[^0-9+]/g, '').slice(0, 13) })}
                      placeholder="e.g. 09171234567"
                      keyboardType="phone-pad"
                      maxLength={13}
                      autoComplete="tel"
                      textContentType="telephoneNumber"
                      returnKeyType="done"
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
                  hitSlop={8}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setShowDropoffContact(!showDropoffContact);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showDropoffContact }}
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
                      autoComplete="name"
                      textContentType="name"
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => dropoffPhoneRef.current?.focus()}
                    />
                    <Input
                      ref={dropoffPhoneRef}
                      label="Contact Phone"
                      value={draftBooking.dropoff_contact_phone ?? ''}
                      onChangeText={(v) => updateDraft({ dropoff_contact_phone: v.replace(/[^0-9+]/g, '').slice(0, 13) })}
                      placeholder="e.g. 09171234567"
                      keyboardType="phone-pad"
                      maxLength={13}
                      autoComplete="tel"
                      textContentType="telephoneNumber"
                      returnKeyType="done"
                    />
                  </>
                )}
              </>
            )}
          </ScrollView>

          {/* Continue CTA lives in the sheet `footer` so it stays visible
              regardless of keyboard / scroll position. */}
        </View>
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
  stepEyebrow: {
    fontSize: 10,
    fontFamily: 'Quicksand_700Bold',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: LightColors.textSecondary,
    marginBottom: 6,
    marginLeft: 2,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: LightColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: LightColors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  phaseTitlePill: {
    marginLeft: 12,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: LightColors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  phaseTitle: {
    fontSize: 16,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textPrimary,
  },
  sheetStepHeader: {
    marginBottom: 8,
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
  // Last row of a dropdown — a divider right above the rounded bottom
  // edge reads as a rendering glitch.
  searchResultItemLast: {
    borderBottomWidth: 0,
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
  searchEmptyText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textTertiary,
  },
  // `top` supplied inline — it depends on the safe-area inset.
  routeErrorWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  routeErrorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(28,28,30,0.82)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  routeErrorText: {
    fontSize: 12,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textInverse,
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
  // `bottom` supplied inline — it tracks the sheet's peek height.
  myLocationBtn: {
    position: 'absolute',
    right: 16,
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
  // `top` supplied inline — it depends on the safe-area inset.
  noMapHint: {
    position: 'absolute',
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
  // `top` supplied inline — it depends on the safe-area inset.
  viewMapWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  viewMapChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: LightColors.surface,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: LightColors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  viewMapChipText: {
    fontSize: 13,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.primary,
  },
  // `top` supplied inline — aligned with the back-button row.
  closeMapBtn: {
    position: 'absolute',
    right: 16,
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
    gap: 10,
    marginBottom: 18,
  },
  quickBtn: {
    // Equal-width pills that share the row and shrink together, so the
    // icon + label always stays on one centered line. (Previously the pills
    // sized to their content in a non-wrapping row with no shrink, so on
    // narrow widths the label dropped under the icon and looked misaligned.)
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LightColors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 12,
  },
  quickBtnPressed: {
    backgroundColor: LightColors.primary100,
  },
  quickBtnText: {
    fontSize: 13,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.primary,
    marginLeft: 6,
  },
  routeSummary: {
    paddingVertical: 4,
    marginBottom: 4,
  },
  routePoint: {
    flexDirection: 'row',
    alignItems: 'center',
    // Lifts the 13px row to a ≥44pt touch target.
    paddingVertical: 12,
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
    // 12 is the app's smallest text rung — 11 sat under the floor.
    fontSize: 12,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.primary,
    marginLeft: 8,
  },
  routeConnector: {
    width: 2,
    height: 24,
    marginLeft: 4,
    // The rows above/below now carry their own 12pt padding — negative
    // margin keeps the bead-to-bead rhythm close to the original.
    marginVertical: -6,
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
    // 12pt padding + 8pt hitSlop lifts the 17pt row past 44pt without
    // visually breaking the form rhythm.
    paddingVertical: 12,
    marginBottom: 4,
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
  errorText: {
    fontSize: 12,
    fontFamily: 'Quicksand_400Regular',
    // dangerDark: base danger is ~3.8:1 on white — below AA for 12px text.
    color: LightColors.dangerDark,
    marginBottom: 8,
  },
});
