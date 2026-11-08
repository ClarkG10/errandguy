import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronRight, PackageSearch } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBookingStore } from '../../../stores/bookingStore';
import { configService } from '../../../services/config.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { BookingStepIndicator } from '../../../components/customer/BookingStepIndicator';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ErrandTypeIcon } from '../../../components/ui/ErrandTypeIcon';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { formatCurrency } from '../../../utils/formatCurrency';
import { errandTypeMinimumPrice } from '../../../utils/errandTypePrice';
import { LightColors, Elevation } from '../../../constants/colors';
import { Radius } from '../../../constants/radius';
import { PressableScale } from '../../../components/customer/booking/PressableScale';
import { useResponsive } from '../../../constants/responsive';
import { getErrandTypeRule } from '../../../constants/errandTypeRules';
import type { ErrandType } from '../../../types';
import { toast } from '../../../stores/toastStore';

export default function TypeSelectionScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ preselected?: string }>();
  // Per-field selectors avoid re-rendering on unrelated bookingStore writes.
  const draftBooking = useBookingStore((s) => s.draftBooking);
  const updateDraft = useBookingStore((s) => s.updateDraft);
  const clearDraft = useBookingStore((s) => s.clearDraft);
  const setStep = useBookingStore((s) => s.setStep);
  const { contentMaxWidth } = useResponsive();
  const insets = useSafeAreaInsets();

  const [errandTypes, setErrandTypes] = useState<ErrandType[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    draftBooking.errand_type_id ?? params.preselected,
  );
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  // A tile tapped while the draft holds another type's details: ask before
  // the switch throws them away (there's no Continue step to catch a mis-tap).
  const [pendingTypeId, setPendingTypeId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Set once the user has confirmed leaving so the beforeRemove guard
  // doesn't re-intercept leaveFlow's own router.back().
  const leavingRef = useRef(false);
  // Guards against a fast double-tap on Continue pushing the next step twice
  // (router.push is non-idempotent and the CTA stays mounted during the push
  // animation). Self-resetting so it can never brick the button.
  const navLatch = useRef(false);
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
  // active-only rows server-side; the grid shows exactly those, in the
  // server's order, and nothing else.
  const errandTypesQ = useQuery<ErrandType[]>(
    ['errand-types'],
    async () => {
      const res = await configService.getErrandTypes();
      return (res.data?.data ?? []) as ErrandType[];
    },
    { staleTime: 60 * 60 * 1000, ttl: CacheTTL.STATIC },
  );

  // Mirror the query result into local state so the existing render
  // pipeline (which reads `errandTypes`) stays untouched. Same `is_active`
  // filter Home applies to the same cache entry, so the two can't disagree.
  useEffect(() => {
    if (errandTypesQ.data) setErrandTypes(errandTypesQ.data.filter((t) => t.is_active));
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
  // since deactivated — never highlight a dangling id (chooseType only ever
  // continues with a tile that's on screen).
  useEffect(() => {
    if (!errandTypesQ.data || !selectedId) return;
    if (!errandTypesQ.data.some((t) => t.id === selectedId && t.is_active)) {
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

  // What switching the draft to another type would throw away: the
  // type-specific details below, and for a one-place errand (Queue) the
  // drop-off and stops too (details.tsx prunes them).
  const switchLosesDetails = (typeId: string, slug: string): boolean => {
    if (!draftBooking.errand_type_id || draftBooking.errand_type_id === typeId) return false;
    return !!(
      draftBooking.description?.trim() ||
      draftBooking.shoppingItems?.some((i) => i.name.trim() !== '') ||
      draftBooking.shopping_budget ||
      draftBooking.estimated_item_value ||
      (getErrandTypeRule(slug).singleLocation &&
        (draftBooking.dropoff_address || (draftBooking.stops?.length ?? 0) > 0))
    );
  };

  // Tapping a tile IS the choice: it goes straight on to details. (It used to
  // only highlight the tile and wait for a Continue tap at the bottom.)
  const chooseType = useCallback((typeId: string, confirmed = false) => {
    const selectedType = errandTypes.find((t) => t.id === typeId);
    if (!selectedType || navLatch.current) return;
    if (!confirmed && switchLosesDetails(typeId, selectedType.slug)) {
      setPendingTypeId(typeId);
      return;
    }
    navLatch.current = true;
    // If errand type changed, drop ONLY the fields that are tied to the
    // previous service shape — the vehicle plus shopping metadata. We deliberately keep pickup/dropoff coords, address text,
    // contact info, and photos because those are reusable and re-typing
    // them is the single most painful part of the flow. The
    // rule-cleanup effect on details.tsx will additionally prune
    // incompatible fields (e.g. dropoff for single-location errands).
    if (
      draftBooking.errand_type_id &&
      draftBooking.errand_type_id !== typeId
    ) {
      updateDraft({
        vehicle_type_rate: undefined,
        shopping_budget: undefined,
        estimated_item_value: undefined,
        // Description/checklist are type-specific — a shopping list makes no
        // sense carried onto a delivery, and on shopping types the
        // description Input is hidden so a stale value would be invisible.
        description: undefined,
        shoppingItems: undefined,
      });
    }
    updateDraft({
      errand_type_id: typeId,
      errand_type_slug: selectedType.slug,
    });
    setStep(1);
    router.push('/(customer)/book/details');
    setTimeout(() => {
      navLatch.current = false;
    }, 700);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- switchLosesDetails reads draftBooking
  }, [errandTypes, draftBooking, updateDraft, setStep, router]);

  return (
    <View className="flex-1 bg-background">
      {/* Title only: the step indicator below already says where the user
          is, so no "Step 1" eyebrow, and no decorative 3D object. */}
      <GradientHeader title="What do you need?" showBack onBackPress={handleBackPress} />

      {/* Step indicator — makes the 3-step funnel visible from step 1
          (previously this screen had no indicator at all). Clamped to
          the same content column as the grid so tablet edges align. */}
      <View className="px-5 mt-1 mb-4">
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
          // Inset-aware so the last row of tiles clears the home
          // indicator / 3-button Android nav bar.
          paddingBottom: Math.max(insets.bottom, 12) + 24,
        }}
        refreshControl={
          <BrandRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {showSkeletons ? (
          // Skeleton mirrors the real card's metrics (radius 16, 62px
          // icon, name, a two-line description, the price row) and the
          // four-type catalogue's 2×2 grid, so the swap to data doesn't
          // reflow.
          <View className="flex-row flex-wrap justify-between" accessibilityLabel="Loading errand types">
            {Array.from({ length: 4 }).map((_, i) => (
              <View
                key={`skeleton-${i}`}
                className="w-[48%] mb-3 p-4 bg-surface border border-divider"
                style={{ height: 196, borderRadius: Radius.card }}
              >
                <View className="rounded-2xl bg-divider mb-3" style={{ width: 62, height: 62 }} />
                <View className="h-3.5 w-3/4 rounded-full bg-divider mb-2.5" />
                <View className="h-2.5 w-full rounded-full bg-divider mb-1.5" />
                <View className="h-2.5 w-2/3 rounded-full bg-divider" />
                <View className="h-2.5 w-1/2 rounded-full bg-divider mt-auto" />
              </View>
            ))}
          </View>
        ) : (
        <View className="flex-row flex-wrap justify-between">
          {errandTypes.map((type) => {
            const isSelected = selectedId === type.id;
            const fromPrice = errandTypeMinimumPrice(type);

            return (
              <PressableScale
                key={type.id}
                accessibilityRole="button"
                accessibilityLabel={[
                  type.name,
                  type.description,
                  fromPrice != null ? `From ${formatCurrency(fromPrice)}` : null,
                ]
                  .filter(Boolean)
                  .join('. ')}
                accessibilityHint="Goes to errand details"
                accessibilityState={{ selected: isSelected }}
                // The touch target is the grid cell; the card inside fills
                // it, so both cards in a row share the taller one's height
                // (descriptions now wrap instead of truncating).
                style={{ width: '48%', marginBottom: 12 }}
                // Selection pattern: the type already in the draft sits on a
                // soft blue-tinted surface with a brand border — content
                // stays DARK on a LIGHT ground (the PNG illustration can't
                // recolour to white, and inverted text kept regressing to
                // invisible white-on-white).
                contentStyle={[
                  {
                    flex: 1,
                    padding: 16,
                    borderRadius: Radius.card,
                    backgroundColor: isSelected ? LightColors.primaryLight : LightColors.surface,
                    borderWidth: 1.5,
                    borderColor: isSelected ? LightColors.primary : LightColors.divider,
                  },
                  isSelected ? Elevation.md : Elevation.sm,
                ]}
                android_ripple={{ color: `${LightColors.primary}14`, borderless: false }}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setSelectedId(type.id);
                  chooseType(type.id);
                }}
              >
                <View className="mb-3">
                  {/* Always 'tinted' — never 'ghost'. ErrandTypeIcon returns a
                      PNG that can't recolor to white, so a ghost variant on a
                      blue tile rendered a washed-out icon. */}
                  <ErrandTypeIcon
                    name={type.icon_name}
                    size="md"
                    variant="tinted"
                  />
                </View>
                {/* Dark text on a light surface in BOTH states — selection
                    is signalled by the tint + border, never by inverting
                    the text color (which kept regressing to invisible). */}
                <Text
                  className="text-[15px] font-montserrat-bold mb-1"
                  style={{ color: isSelected ? LightColors.primaryDark : LightColors.textPrimary }}
                >
                  {type.name}
                </Text>
                {/* Wraps in full — the description is what tells the types
                    apart, so it is never cut off with "…". */}
                <Text
                  className="text-[13px] font-montserrat leading-[18px]"
                  style={{ color: LightColors.textSecondary }}
                >
                  {type.description}
                </Text>
                {/* Price + chevron pinned to the card's foot: the "this
                    goes somewhere" affordance. The true least it can cost —
                    service fee included (the base fee alone undersold every
                    type by 15%). */}
                <View className="flex-row items-center justify-between mt-auto pt-3">
                  {fromPrice != null ? (
                    <Text
                      className="text-[13px] font-inter-medium flex-shrink"
                      style={{ color: LightColors.textPrimary, fontVariant: ['tabular-nums'] }}
                      numberOfLines={1}
                    >
                      From {formatCurrency(fromPrice)}
                    </Text>
                  ) : (
                    <View />
                  )}
                  <ChevronRight size={18} color={LightColors.primary} strokeWidth={2.25} />
                </View>
              </PressableScale>
            );
          })}
        </View>
        )}
        {/* Load failure with nothing cached → inline recovery. Retry
            re-shows the skeleton grid (via `refreshing`) so the attempt
            has visible progress. */}
        {!showSkeletons && errandTypes.length === 0 && errandTypesQ.error && (
          <ErrorState
            error={errandTypesQ.error}
            title="Couldn't load errand types"
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

      <ConfirmModal
        visible={showDiscardModal}
        title="Discard this errand?"
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
      <ConfirmModal
        visible={pendingTypeId != null}
        title="Switch errand type?"
        message="The details you entered for this errand won't carry over to the new type."
        confirmLabel="Switch"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          const typeId = pendingTypeId;
          setPendingTypeId(null);
          if (typeId) chooseType(typeId, true);
        }}
        onCancel={() => setPendingTypeId(null)}
      />
    </View>
  );
}
