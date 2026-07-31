import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { PackageSearch } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBookingStore } from '../../../stores/bookingStore';
import { configService } from '../../../services/config.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { Button } from '../../../components/ui/Button';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { BookingStepIndicator } from '../../../components/customer/BookingStepIndicator';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ErrandTypeIcon } from '../../../components/ui/ErrandTypeIcon';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { Illustration } from '../../../components/ui/Illustration';
import { formatCurrency } from '../../../utils/formatCurrency';
import { LightColors, Elevation } from '../../../constants/colors';
import { useResponsive } from '../../../constants/responsive';
import type { ErrandType } from '../../../types';
import { toast } from '../../../stores/toastStore';

export default function TypeSelectionScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ preselected?: string }>();
  const { draftBooking, updateDraft, clearDraft, setStep } = useBookingStore();
  const { contentMaxWidth } = useResponsive();
  const insets = useSafeAreaInsets();

  const [errandTypes, setErrandTypes] = useState<ErrandType[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    draftBooking.errand_type_id ?? params.preselected,
  );
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Set once the user has confirmed leaving so the beforeRemove guard
  // doesn't re-intercept leaveFlow's own router.back().
  const leavingRef = useRef(false);
  // `preselected` should only seed the initial selection — once the user
  // taps another tile the prop must not yank them back. Track whether
  // we've already consumed it.
  const preselectAppliedRef = useRef<boolean>(
    !!(draftBooking.errand_type_id || params.preselected),
  );

  // SWR-style cache so repeat visits paint instantly from AsyncStorage
  // even on cold start, then revalidate in the background. Shares the
  // ['errand-types'] cache key with the customer home tile so a single
  // fetch warms both screens. The /errand-types endpoint already returns
  // active-only rows server-side.
  const errandTypesQ = useQuery<ErrandType[]>(
    ['errand-types'],
    async () => {
      const res = await configService.getErrandTypes();
      return (res.data?.data ?? []) as ErrandType[];
    },
    { staleTime: 60 * 60 * 1000, ttl: CacheTTL.STATIC },
  );

  // Mirror the query result into local state so the existing render
  // pipeline (which reads `errandTypes`) stays untouched.
  useEffect(() => {
    if (errandTypesQ.data) setErrandTypes(errandTypesQ.data);
  }, [errandTypesQ.data]);
  // useQuery never re-raises `loading` after the first resolution, so
  // pull-to-refresh / retry need their own in-progress flag or the
  // spinner snaps shut with no feedback.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await errandTypesQ.refresh();
    } finally {
      setRefreshing(false);
    }
  }, [errandTypesQ.refresh]);

  // Only toast when a background revalidate fails behind cached tiles —
  // with nothing cached the inline ErrorState owns the failure alone.
  useEffect(() => {
    if (errandTypesQ.error && errandTypes.length > 0) {
      toast.error("Couldn't refresh errand types", {
        actionLabel: 'Retry',
        onAction: () => {
          handleRefresh().catch(() => {});
        },
      });
    }
  }, [errandTypesQ.error]);
  const loadingTypes = errandTypesQ.loading && errandTypes.length === 0;
  const showSkeletons =
    (loadingTypes || refreshing) && errandTypes.length === 0;

  // A persisted draft or deep link can reference a type that config has
  // since deactivated — never let Continue proceed with a dangling id.
  const selectionValid =
    !!selectedId && errandTypes.some((t) => t.id === selectedId);
  useEffect(() => {
    if (!errandTypesQ.data || !selectedId) return;
    if (!errandTypesQ.data.some((t) => t.id === selectedId)) {
      setSelectedId(undefined);
    }
  }, [errandTypesQ.data, selectedId]);

  useEffect(() => {
    if (preselectAppliedRef.current) return;
    if (params.preselected && !draftBooking.errand_type_id) {
      setSelectedId(params.preselected);
      preselectAppliedRef.current = true;
    }
  }, [params.preselected, draftBooking.errand_type_id]);

  // True if the user has any meaningful draft data — used to decide
  // whether the back button should silently leave or prompt to discard.
  const hasDraftData = !!(
    draftBooking.errand_type_id ||
    draftBooking.pickup_address ||
    draftBooking.dropoff_address ||
    draftBooking.description ||
    (draftBooking.item_photos?.length ?? 0) > 0
  );

  const leaveFlow = useCallback(() => {
    leavingRef.current = true;
    clearDraft();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(customer)/(tabs)');
    }
  }, [clearDraft, router]);

  const handleBackPress = useCallback(() => {
    if (hasDraftData) {
      setShowDiscardModal(true);
    } else {
      leaveFlow();
    }
  }, [hasDraftData, leaveFlow]);

  // Header back goes through handleBackPress, but Android hardware back
  // and the iOS swipe-back gesture pop the screen directly — intercept
  // those too so no path can silently drop a mid-flight draft.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!hasDraftData || leavingRef.current) return;
      e.preventDefault();
      setShowDiscardModal(true);
    });
    return unsubscribe;
  }, [navigation, hasDraftData]);

  const handleContinue = useCallback(() => {
    if (!selectedId || !selectionValid) return;
    const selectedType = errandTypes.find((t) => t.id === selectedId);
    // If errand type changed, drop ONLY the fields that are tied to the
    // previous service shape — pricing/vehicle/offer plus shopping
    // metadata. We deliberately keep pickup/dropoff coords, address text,
    // contact info, and photos because those are reusable and re-typing
    // them is the single most painful part of the flow. The
    // rule-cleanup effect on details.tsx will additionally prune
    // incompatible fields (e.g. dropoff for single-location errands).
    if (
      draftBooking.errand_type_id &&
      draftBooking.errand_type_id !== selectedId
    ) {
      updateDraft({
        vehicle_type_rate: undefined,
        customer_offer: undefined,
        pricing_mode: undefined,
        shopping_budget: undefined,
        estimated_item_value: undefined,
        // Description/checklist are type-specific — a "Grocery list" makes no
        // sense carried onto a "Document" errand, and on shopping types the
        // description Input is hidden so a stale value would be invisible.
        description: undefined,
        shoppingItems: undefined,
      });
    }
    updateDraft({
      errand_type_id: selectedId,
      errand_type_slug: selectedType?.slug,
    });
    setStep(1);
    router.push('/(customer)/book/details');
  }, [selectedId, selectionValid, errandTypes, draftBooking.errand_type_id, updateDraft, setStep, router]);

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="What do you need?" showBack onBackPress={handleBackPress}>
        <View className="px-5 -mt-2 pb-3 flex-row items-center justify-between">
          <Text
            className="text-[10px] font-montserrat-bold uppercase"
            style={{ letterSpacing: 1.4, color: LightColors.textSecondary }}
          >
            New errand · Step 1
          </Text>
          {/* Small 3D parcel hero beside the heading — decorative only. */}
          <Illustration name="3d-parcel" size={88} />
        </View>
      </GradientHeader>

      {/* Step indicator — makes the 4-step funnel visible from step 1
          (previously this screen had no indicator at all). Clamped to
          the same content column as the grid so tablet edges align. */}
      <View className="px-5 mt-3 mb-3">
        <View style={{ maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}>
          <BookingStepIndicator currentStep={0} />
        </View>
      </View>

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          maxWidth: contentMaxWidth,
          width: '100%',
          alignSelf: 'center',
          // Let the empty/error states (flex-1) center vertically when
          // the grid has nothing to show.
          flexGrow: 1,
          // Clearance for the sticky BottomActionBar: its height is
          // 16 top pad + ~48-51 button + max(inset, 12) bottom pad, so
          // a fixed spacer under-shoots on notch iPhones (34pt inset)
          // and 3-button Android (48dp). Inset-aware keeps the last
          // row of tiles clear of the bar on every device.
          paddingBottom: Math.max(insets.bottom, 12) + 96,
        }}
        refreshControl={
          <BrandRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {showSkeletons ? (
          // Skeleton mirrors the real card's metrics (radius 20, 62px
          // icon, ~2-line description) so the swap to data doesn't reflow.
          <View className="flex-row flex-wrap justify-between">
            {Array.from({ length: 6 }).map((_, i) => (
              <View
                key={`skeleton-${i}`}
                className="w-[48%] mb-3 p-4 bg-surface"
                style={{ height: 180, borderRadius: 20, opacity: 0.6 }}
              >
                <View className="rounded-2xl bg-divider mb-2" style={{ width: 62, height: 62 }} />
                <View className="h-3 w-3/4 rounded-full bg-divider mb-2" />
                <View className="h-2 w-full rounded-full bg-divider mb-1.5" />
                <View className="h-2 w-1/2 rounded-full bg-divider" />
              </View>
            ))}
          </View>
        ) : (
        <View
          className="flex-row flex-wrap justify-between"
          accessibilityRole="radiogroup"
          accessibilityLabel="Errand type"
        >
          {errandTypes.map((type) => {
            const isSelected = selectedId === type.id;
            const isTransportation = type.slug === 'transportation';

            return (
              <Pressable
                key={type.id}
                accessibilityRole="radio"
                accessibilityLabel={`${type.name}. ${
                  type.description ? `${type.description}. ` : ''
                }From ${formatCurrency(type.base_fee)}`}
                accessibilityState={{ checked: isSelected, selected: isSelected }}
                // Selection pattern: the chosen tile lifts to a soft
                // blue-tinted surface with a 2px brand border — content
                // stays DARK on a LIGHT ground. (The old pattern filled the
                // tile solid blue and inverted the text/icon to white; but
                // the PNG illustration doesn't recolor to white, and inverted
                // text repeatedly regressed to invisible white-on-white. A
                // tint+border keeps every element legible with no inversion.)
                className="w-[48%] mb-3 p-4"
                style={({ pressed }) => [
                  {
                    borderRadius: 16,
                    backgroundColor: isSelected ? LightColors.primaryLight : LightColors.surface,
                    borderWidth: 1.5,
                    borderColor: isSelected ? LightColors.primary : 'transparent',
                  },
                  isSelected ? Elevation.md : Elevation.sm,
                  pressed ? { opacity: 0.92, transform: [{ scale: 0.985 }] } : null,
                ]}
                android_ripple={{ color: `${LightColors.primary}14`, borderless: false }}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setSelectedId(type.id);
                }}
              >
                <View className="flex-row items-start justify-between mb-2">
                  {/* Always 'tinted' — never 'ghost'. ErrandTypeIcon returns a
                      PNG that can't recolor to white, so a ghost variant on a
                      blue tile rendered a washed-out icon. */}
                  <ErrandTypeIcon
                    name={type.icon_name}
                    size="md"
                    variant="tinted"
                  />
                  {isTransportation && (
                    <Text
                      className="text-[10px] font-montserrat-bold uppercase mt-1 text-accentDark bg-accentSoft rounded-full px-2 py-0.5"
                      style={{ letterSpacing: 1.2 }}
                    >
                      Ride
                    </Text>
                  )}
                </View>
                {/* Dark text on a light surface in BOTH states — selection
                    is signalled by the tint + border, never by inverting
                    the text color (which kept regressing to invisible). */}
                <Text
                  className="text-[14px] font-montserrat-bold mb-1"
                  style={{ color: isSelected ? LightColors.primaryDark : LightColors.textPrimary }}
                  numberOfLines={2}
                >
                  {type.name}
                </Text>
                {/* minHeight reserves the 2-line block so one-line
                    descriptions don't produce ragged card heights. */}
                <Text
                  className="text-[12px] font-montserrat mb-3 leading-[16px]"
                  style={{ minHeight: 32, color: LightColors.textSecondary }}
                  numberOfLines={2}
                >
                  {type.description}
                </Text>
                <Text
                  className="text-[12px] font-inter tabular-nums"
                  style={{ color: LightColors.textSecondary }}
                  numberOfLines={1}
                >
                  From {formatCurrency(type.base_fee)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        )}
        {/* Load failure with nothing cached → inline recovery. Retry
            re-shows the skeleton grid (via `refreshing`) so the attempt
            has visible progress. */}
        {!showSkeletons && errandTypes.length === 0 && errandTypesQ.error && (
          <ErrorState
            title="Couldn't load errand types"
            description="Check your internet connection and try again."
            onRetry={() => {
              handleRefresh().catch(() => {});
            }}
            style={{ paddingVertical: 32 }}
          />
        )}
        {/* Genuinely empty (fetch succeeded, zero rows) → proper empty
            state with a retry CTA instead of a misleading spinner. */}
        {!showSkeletons && errandTypes.length === 0 && !errandTypesQ.error && (
          <EmptyState
            icon={PackageSearch}
            title="No errand types available"
            description="There's nothing bookable right now. Try refreshing in a moment."
            actionLabel="Refresh"
            onAction={() => {
              handleRefresh().catch(() => {});
            }}
          />
        )}
      </ScrollView>

      {/* Bottom CTA */}
      <BottomActionBar>
        <View style={{ maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}>
          <Button
            title={selectedId ? 'Continue' : 'Choose an errand type'}
            onPress={handleContinue}
            disabled={!selectionValid}
            fullWidth
            accessibilityHint="Goes to errand details"
          />
        </View>
      </BottomActionBar>

      <ConfirmModal
        visible={showDiscardModal}
        title="Discard this booking?"
        message="You'll lose the details you've entered so far."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setShowDiscardModal(false);
          leaveFlow();
        }}
        onCancel={() => setShowDiscardModal(false)}
      />
    </View>
  );
}
