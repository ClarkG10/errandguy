import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { MapPin } from 'lucide-react-native';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { LightColors, Elevation } from '../../../constants/colors';
import { HereMapView, HereMarker, HereCircle, type HereMapViewRef } from '../../../components/map';
import Slider from '@react-native-community/slider';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { Skeleton } from '../../../components/ui/Skeleton';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { useResponsive } from '../../../constants/responsive';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useLocationStore } from '../../../stores/locationStore';
import { runnerService } from '../../../services/runner.service';
import { getCurrentCoords } from '../../../utils/locationPermission';
import { runOptimistic } from '../../../utils/optimistic';
import { queueable } from '../../../services/mutationQueue';
import { toast } from '../../../stores/toastStore';

// h-56 map frame height — the loading veil + delta math key off it.
const MAP_HEIGHT = 224;

// Latitude delta that keeps the whole radius circle framed with margin.
// Circle diameter in degrees ≈ 2·r / 111320; the ×1.3 headroom leaves the
// stroke off the frame edge as the radius grows, so the map stays a live
// coverage preview instead of clipping the circle at large radii.
const deltaForRadius = (r: number) => Math.max(0.02, r / 42000);

export default function WorkingAreasScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useResponsive();
  const { runnerProfile, setRunnerProfile } = useRunnerStore();
  const { currentLocation, setCurrentLocation } = useLocationStore();

  // `radius` drives the live km label + slider position + dirty check every
  // tick (cheap). `mapRadius` is a throttled copy that feeds the map (circle
  // polygon rebuild + camera fit) so the 64-vertex HereCircle + native source
  // push don't run on every drag frame — keeps the slide smooth on low Android.
  const initialRadius = runnerProfile?.working_area_radius ?? 5000;
  const [radius, setRadius] = useState(initialRadius);
  const [mapRadius, setMapRadius] = useState(initialRadius);
  const [refreshing, setRefreshing] = useState(false);
  const [requestingLocation, setRequestingLocation] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  // Real user interaction with the radius/center — distinct from `isDirty`.
  // A first-time runner (no saved working_area_lat/lng) reads as dirty the
  // instant currentLocation seeds the center, which is correct for Save
  // (there IS a new area to persist) but must NOT trip the discard guard on
  // a back with no edit. The guard keys off this flag; Save still keys off
  // isDirty so its gating is unchanged.
  const [touched, setTouched] = useState(false);

  const mapRef = useRef<HereMapViewRef>(null);

  // Haptic tick bookkeeping for the radius slider — fire a selection
  // tick when the value crosses a whole-km boundary, time-throttled so
  // a fast fling doesn't queue a burst of vibrations.
  const lastKmRef = useRef(Math.floor(initialRadius / 1000));
  const lastTickAtRef = useRef(0);

  // Throttle bookkeeping for the map-feeding radius (leading + trailing edge).
  const mapThrottleAtRef = useRef(0);
  const mapThrottleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lat = runnerProfile?.working_area_lat ?? currentLocation?.lat ?? 0;
  const lng = runnerProfile?.working_area_lng ?? currentLocation?.lng ?? 0;

  // Dirty = the runner has actually moved the center or the radius off the
  // saved profile. A no-op Save is gated so it can't fire an optimistic write
  // + network call for an identical value. A first-time set (saved lat/lng
  // undefined, current location seeded) reads as dirty — that's a real change.
  const isDirty =
    radius !== initialRadius ||
    lat !== runnerProfile?.working_area_lat ||
    lng !== runnerProfile?.working_area_lng;

  // Unsaved-edit guard: only prompt to discard when the runner has actually
  // touched a control AND there's a real diff. Stops the false "Discard
  // changes?" modal for a brand-new runner whose center just got seeded from
  // currentLocation without any interaction.
  const hasUnsavedEdit = touched && isDirty;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await runnerService.getRunnerProfile();
      setRunnerProfile(res.data.data);
      const r = res.data.data?.working_area_radius ?? 5000;
      setRadius(r);
      setMapRadius(r);
    } catch {}
    setRefreshing(false);
  }, []);

  // Keep the camera framed on the circle whenever the (throttled) radius or
  // center moves. Gated on mapReady so flyTo isn't called before the camera
  // mounts — the initialRegion already frames the saved radius at first paint.
  useEffect(() => {
    if (!mapReady || !lat || !lng) return;
    const delta = deltaForRadius(mapRadius);
    mapRef.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta },
      250,
    );
  }, [mapReady, mapRadius, lat, lng]);

  // Drop any pending trailing-edge map update on unmount.
  useEffect(() => {
    return () => {
      if (mapThrottleTimer.current) clearTimeout(mapThrottleTimer.current);
    };
  }, []);

  // Once the user confirms discarding (or leaves intentionally) the
  // beforeRemove guard must not re-intercept our own router.back().
  const leavingRef = useRef(false);

  const leaveScreen = useCallback(() => {
    leavingRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/(runner)/(tabs)/profile');
  }, [router]);

  const handleBackPress = useCallback(() => {
    if (hasUnsavedEdit) setShowDiscard(true);
    else leaveScreen();
  }, [hasUnsavedEdit, leaveScreen]);

  // Header back runs through handleBackPress, but Android hardware back and
  // the iOS swipe-back gesture pop directly — intercept those too so no path
  // silently drops an unsaved working-area edit.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (!hasUnsavedEdit || leavingRef.current) return;
      e.preventDefault();
      setShowDiscard(true);
    });
    return unsub;
  }, [navigation, hasUnsavedEdit]);

  const handleSave = async () => {
    if (!lat || !lng) {
      toast.warning('Please enable location services to set your working area.');
      return;
    }
    // Both the wire payload AND the optimistic apply use the three SEPARATE
    // working_area_lat/lng/radius fields. The backend FormRequest
    // (UpdateRunnerProfileRequest) accepts ONLY those three — there is no
    // `working_area` rule/accessor, so `->update($request->validated())` would
    // silently DROP a `working_area` JSON key (the old payload here), persisting
    // nothing while the optimistic UI + success toast claimed it saved.
    // Rolls back profile + radius on failure; the service invalidates
    // ['runner','profile'], so no post-save refetch is needed.
    const prev = runnerProfile;
    const q = queueable(
      'runner.updateProfile',
      { working_area_lat: lat, working_area_lng: lng, working_area_radius: radius },
      { dedupeKey: 'runner-profile-working-area' },
    );
    await runOptimistic({
      apply: () => {
        if (runnerProfile) {
          setRunnerProfile({
            ...runnerProfile,
            working_area_lat: lat,
            working_area_lng: lng,
            working_area_radius: radius,
          });
        }
      },
      // Rollback only undoes what apply changed (the profile). The `radius`
      // slider is the user's in-progress input — apply never touched it, so
      // leave it intact on failure so they can just retry Save.
      rollback: () => setRunnerProfile(prev),
      commit: q.commit,
      offline: q.offline,
      errorMessage: "Couldn't update your working area.",
      retry: true,
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        toast.success('Working area updated');
      },
    });
  };

  const radiusKm = (radius / 1000).toFixed(1);

  // Push the map-feeding radius on the throttle's leading edge, then schedule
  // a trailing update so the final resting value always lands even if the last
  // tick fell inside the throttle window.
  const pushMapRadius = useCallback((value: number) => {
    const now = Date.now();
    if (now - mapThrottleAtRef.current >= 120) {
      mapThrottleAtRef.current = now;
      if (mapThrottleTimer.current) {
        clearTimeout(mapThrottleTimer.current);
        mapThrottleTimer.current = null;
      }
      setMapRadius(value);
    } else {
      if (mapThrottleTimer.current) clearTimeout(mapThrottleTimer.current);
      mapThrottleTimer.current = setTimeout(() => {
        mapThrottleAtRef.current = Date.now();
        mapThrottleTimer.current = null;
        setMapRadius(value);
      }, 120);
    }
  }, []);

  const handleRadiusChange = useCallback(
    (value: number) => {
      setTouched(true);
      setRadius(value);
      pushMapRadius(value);
      const km = Math.floor(value / 1000);
      if (km !== lastKmRef.current) {
        lastKmRef.current = km;
        const now = Date.now();
        if (now - lastTickAtRef.current >= 80) {
          lastTickAtRef.current = now;
          Haptics.selectionAsync().catch(() => {});
        }
      }
    },
    [pushMapRadius],
  );

  // Commit the final value to the map immediately on release — the trailing
  // throttle may still be pending, so this guarantees the circle + camera
  // settle on exactly where the thumb stopped.
  const handleSlidingComplete = useCallback((value: number) => {
    if (mapThrottleTimer.current) {
      clearTimeout(mapThrottleTimer.current);
      mapThrottleTimer.current = null;
    }
    mapThrottleAtRef.current = Date.now();
    setTouched(true);
    setRadius(value);
    setMapRadius(value);
  }, []);

  // Placeholder CTA — asks for the location permission (with the
  // Settings deep-link fallback) and seeds the location store so the
  // map appears without leaving the screen.
  const handleEnableLocation = useCallback(async () => {
    setRequestingLocation(true);
    try {
      const pos = await getCurrentCoords({ feature: 'show your working area on the map' });
      if (pos) {
        setCurrentLocation({ lat: pos.lat, lng: pos.lng });
      } else {
        toast.warning('Location is unavailable. Check your GPS settings and try again.');
      }
    } finally {
      setRequestingLocation(false);
    }
  }, [setCurrentLocation]);


  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Working Areas"
        showBack
        fallbackHref="/(runner)/(tabs)/profile"
        onBackPress={handleBackPress}
      />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{
          width: '100%',
          maxWidth: contentMaxWidth,
          alignSelf: 'center',
          // Clear the sticky Save bar (padTop 16 + button minHeight ~46 +
          // its own bottom inset) at every nav-bar height and font scale.
          paddingBottom: Math.max(insets.bottom, 12) + 96,
        }}
      >
        {/* Map with circle overlay */}
        <View className="mx-5 h-56 rounded-2xl overflow-hidden mb-4">
          {lat && lng ? (
            <>
              <HereMapView
                ref={mapRef}
                style={{ flex: 1 }}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                onMapReady={() => setMapReady(true)}
                initialRegion={{
                  latitude: lat,
                  longitude: lng,
                  latitudeDelta: deltaForRadius(mapRadius),
                  longitudeDelta: deltaForRadius(mapRadius),
                }}
              >
                {/* Center marker */}
                <HereMarker coordinate={{ latitude: lat, longitude: lng }} id="center-marker">
                  <View
                    className="w-8 h-8 rounded-full bg-primary items-center justify-center border-2 border-white"
                    style={Elevation.sm}
                  >
                    <MapPin size={14} color={LightColors.textInverse} />
                  </View>
                </HereMarker>

                {/* Radius circle */}
                <HereCircle
                  id="working-area"
                  center={{ latitude: lat, longitude: lng }}
                  radius={mapRadius}
                  fillColor={`${LightColors.primary}1F`}
                  strokeColor={LightColors.primary}
                  strokeWidth={2}
                />
              </HereMapView>

              {/* Loading veil — HERE raster tiles paint a grey checkerboard
                  until onDidFinishLoadingMap; on slow Android that reads as a
                  broken map with the pin/circle floating. Hold a shimmer over
                  the frame until the first tiles land. */}
              {!mapReady && (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <Skeleton width="100%" height={MAP_HEIGHT} borderRadius={0} />
                </View>
              )}
            </>
          ) : (
            <View className="flex-1 bg-surfaceMuted items-center justify-center px-6">
              <MapPin size={32} color={LightColors.textMuted} />
              <Text className="text-sm font-montserrat text-textSecondary mt-2 mb-3 text-center">
                Enable location to view map
              </Text>
              <Button
                title="Enable Location"
                onPress={handleEnableLocation}
                loading={requestingLocation}
                loadingTitle="Requesting…"
                variant="secondary"
              />
            </View>
          )}
        </View>

        {/* Center Location */}
        <View className="px-5 mb-4">
          <Card className="p-4">
            <Text className="text-sm font-montserrat-bold text-textSecondary mb-1">
              Center Point
            </Text>
            <Text className="text-sm font-montserrat text-textPrimary">
              {lat && lng
                ? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
                : 'Location not available'}
            </Text>
            <Text className="text-xs font-montserrat text-textSecondary mt-1">
              Uses your current location or previously saved center.
            </Text>
          </Card>
        </View>

        {/* Radius Slider */}
        <View className="px-5 mb-4">
          <Card className="p-4">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-sm font-montserrat-bold text-textSecondary">
                Working Radius
              </Text>
              <Text className="text-sm font-montserrat-bold text-primary">
                {radiusKm} km
              </Text>
            </View>
            <Slider
              minimumValue={1000}
              maximumValue={50000}
              step={500}
              value={radius}
              onValueChange={handleRadiusChange}
              onSlidingComplete={handleSlidingComplete}
              minimumTrackTintColor={LightColors.primary}
              maximumTrackTintColor={LightColors.divider}
              thumbTintColor={LightColors.primary}
              accessibilityLabel="Working radius"
              accessibilityValue={{ min: 1, max: 50, now: Number(radiusKm), text: `${radiusKm} km` }}
            />
            <View className="flex-row justify-between mt-1">
              <Text className="text-xs font-montserrat text-textTertiary">1 km</Text>
              <Text className="text-xs font-montserrat text-textTertiary">50 km</Text>
            </View>
          </Card>
        </View>

        <View className="px-5">
          <Text className="text-xs font-montserrat text-textSecondary leading-5">
            You will receive errand requests within this radius of your center point.
            A larger radius gives you more requests but may require longer travel.
          </Text>
        </View>
      </ScrollView>

      {/* Save Button — dirty-gated so a no-op tap can't fire an optimistic
          write + network call; disabled too while location is missing. */}
      <BottomActionBar>
        <Button
          title="Save Working Area"
          onPress={handleSave}
          disabled={!isDirty || !lat || !lng}
          fullWidth
        />
      </BottomActionBar>

      <ConfirmModal
        visible={showDiscard}
        title="Discard changes?"
        message="Your working area changes haven't been saved yet. Leave without saving?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setShowDiscard(false);
          leaveScreen();
        }}
        onCancel={() => setShowDiscard(false)}
      />
    </View>
  );
}
