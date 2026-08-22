import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Card } from '../../../components/ui/Card';
import { LightColors } from '../../../constants/colors';
import { useResponsive } from '../../../constants/responsive';
import { Button } from '../../../components/ui/Button';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { useRunnerStore } from '../../../stores/runnerStore';
import { runnerService } from '../../../services/runner.service';
import { configService } from '../../../services/config.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { runOptimistic } from '../../../utils/optimistic';
import { queueable } from '../../../services/mutationQueue';
import { toast } from '../../../stores/toastStore';
import type { ErrandType } from '../../../types';

export default function PreferredTypesScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { contentMaxWidth } = useResponsive();
  const { runnerProfile, setRunnerProfile } = useRunnerStore();

  const [refreshing, setRefreshing] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);

  // Errand types come from the same config source the customer booking
  // flow uses, sharing the ['errand-types'] cache key so a single fetch
  // warms both the runner preferences screen and the customer picker.
  // The /errand-types endpoint already returns active-only rows.
  const errandTypesQ = useQuery<ErrandType[]>(
    ['errand-types'],
    async () => {
      const res = await configService.getErrandTypes();
      return (res.data?.data ?? []) as ErrandType[];
    },
    { staleTime: 60 * 60 * 1000, ttl: CacheTTL.STATIC },
  );

  // Live source list, reduced to the fields this checklist needs.
  const sourceTypes = useMemo(
    () =>
      (errandTypesQ.data ?? []).map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
      })),
    [errandTypesQ.data],
  );

  // Selection is tracked separately from the source list so a background
  // revalidate (or pull-to-refresh) of the errand-type catalog never wipes
  // the runner's in-progress edits.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Seed from the persisted profile ONCE (the first time it's available) and
  // never re-seed on later runnerProfile reference changes. Previously this
  // re-seeded on EVERY change, so a pull-to-refresh mid-edit (onRefresh
  // replaces runnerProfile) — or the dashboard tab landing a profileQ result —
  // silently discarded the runner's in-progress toggles, defeating the
  // screen's own dirty/discard guards. After a save `selected` already matches
  // the persisted set (no re-seed needed); a genuinely new server value is
  // picked up on the next mount.
  const didSeedRef = useRef(false);
  useEffect(() => {
    if (didSeedRef.current || !runnerProfile) return;
    setSelected(new Set(runnerProfile.preferred_types ?? []));
    didSeedRef.current = true;
  }, [runnerProfile]);

  // Render model: each source type carries its current checked state.
  const options = useMemo(
    () => sourceTypes.map((t) => ({ ...t, selected: selected.has(t.slug) })),
    [sourceTypes, selected],
  );

  const toggleType = (slug: string) => {
    Haptics.selectionAsync().catch(() => {});
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const handleSave = async () => {
    // Derive from the visible options so any slug for a since-deactivated
    // type (absent from the catalog) is naturally pruned on save.
    const selectedSlugs = options.filter((t) => t.selected).map((t) => t.slug);
    if (selectedSlugs.length === 0) {
      toast.warning('Please select at least one errand type.');
      return;
    }
    // Optimistic: the selection already renders instantly (local `types`);
    // reflect it in the runner profile immediately and confirm in the
    // background. Rolls back to the previous profile on failure. The old
    // post-save getRunnerProfile refetch was redundant — the service
    // invalidates ['runner','profile'] on success and the tab refetches on
    // focus.
    const prev = runnerProfile;
    const q = queueable('runner.updateProfile', { preferred_types: selectedSlugs }, {
      dedupeKey: 'runner-profile-preferred-types',
    });
    await runOptimistic({
      apply: () => {
        if (runnerProfile) setRunnerProfile({ ...runnerProfile, preferred_types: selectedSlugs });
      },
      rollback: () => setRunnerProfile(prev),
      commit: q.commit,
      offline: q.offline,
      errorMessage: "Couldn't update your errand types.",
      retry: true,
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        toast.success('Preferred errand types updated');
      },
    });
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Refresh both the persisted preferences and the errand-type catalog
      // so a newly-added type shows up here without a cold restart.
      await Promise.all([
        runnerService
          .getRunnerProfile()
          .then((res) => setRunnerProfile(res.data.data))
          .catch(() => {}),
        errandTypesQ.refresh().catch(() => {}),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [errandTypesQ.refresh]);

  // While the catalog is still loading, show the persisted intent so the
  // header doesn't flash "0 selected"; once loaded, count only the visible
  // checked rows so a since-deactivated persisted slug doesn't inflate it.
  const selectedCount =
    sourceTypes.length === 0
      ? selected.size
      : options.filter((t) => t.selected).length;

  // Dirty = current selection differs from the persisted profile set, so
  // Save can be disabled on a no-op edit and backing out mid-edit prompts
  // a discard confirm instead of silently dropping the change. Only
  // meaningful once the catalog has loaded — an empty options list while
  // loading would otherwise read as "everything deselected".
  const initialSet = useMemo(
    () => new Set(runnerProfile?.preferred_types ?? []),
    [runnerProfile],
  );
  const dirty = useMemo(() => {
    if (sourceTypes.length === 0) return false;
    // Compare only against persisted slugs that still exist in the live
    // catalog — a since-deactivated preferred type is absent from `options`,
    // so counting it would make an untouched screen read as edited (spurious
    // discard prompt). It still gets harmlessly pruned on the next real save.
    const catalogSlugs = new Set(sourceTypes.map((t) => t.slug));
    const initialInCatalog = [...initialSet].filter((s) => catalogSlugs.has(s));
    const selectedNow = options.filter((t) => t.selected);
    return (
      selectedNow.length !== initialInCatalog.length ||
      selectedNow.some((t) => !initialSet.has(t.slug))
    );
  }, [options, sourceTypes, initialSet]);

  // Loading / error surfaces mirror the customer booking picker: show
  // skeletons on a cold load, an inline ErrorState (with retry) when the
  // fetch fails with nothing cached, and an EmptyState if config returns
  // no active types.
  const loadingTypes = errandTypesQ.loading && sourceTypes.length === 0;
  const showSkeletons = (loadingTypes || refreshing) && sourceTypes.length === 0;
  const showError = !showSkeletons && sourceTypes.length === 0 && !!errandTypesQ.error;
  const showEmpty =
    !showSkeletons && !showError && !errandTypesQ.loading && sourceTypes.length === 0;

  // Once the user confirms leaving, the beforeRemove guard must not
  // re-intercept our own router.back().
  const leavingRef = useRef(false);

  const leave = useCallback(() => {
    leavingRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/(runner)/(tabs)/profile');
  }, [router]);

  const handleBackPress = useCallback(() => {
    if (dirty) setShowDiscard(true);
    else leave();
  }, [dirty, leave]);

  // Header back runs through handleBackPress, but Android hardware back
  // and the iOS swipe-back gesture pop the screen directly — intercept
  // those too so no path silently drops unsaved errand-type edits.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!dirty || leavingRef.current) return;
      e.preventDefault();
      setShowDiscard(true);
    });
    return unsub;
  }, [navigation, dirty]);

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Preferred Errand Types"
        showBack
        fallbackHref="/(runner)/(tabs)/profile"
        onBackPress={handleBackPress}
      >
        <View className="px-5 pb-2">
          <Text
            className="text-xs font-montserrat text-textSecondary"
            accessibilityLiveRegion="polite"
          >
            {selectedCount} selected • min 1 required
          </Text>
        </View>
      </GradientHeader>

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        refreshControl={<BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{
          paddingBottom: 120,
          maxWidth: contentMaxWidth,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <Text className="text-sm font-montserrat text-textSecondary mb-3">
          Select the errand types you want to receive requests for.
        </Text>

        {showSkeletons ? (
          <View accessibilityLabel="Loading errand types" accessibilityState={{ busy: true }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={56} borderRadius={16} style={{ marginBottom: 8 }} />
            ))}
          </View>
        ) : showError ? (
          <ErrorState
            title="Couldn't load errand types"
            description="Check your connection and try again."
            onRetry={() => {
              errandTypesQ.refresh().catch(() => {});
            }}
          />
        ) : showEmpty ? (
          <EmptyState
            title="No errand types available"
            description="There are no active errand types to choose from right now."
          />
        ) : (
          options.map((type) => (
            <Pressable
              key={type.slug}
              onPress={() => toggleType(type.slug)}
              accessibilityRole="checkbox"
              accessibilityLabel={type.name}
              accessibilityState={{ checked: type.selected }}
            >
              <Card className={`mb-2 p-4 flex-row items-center justify-between border ${type.selected ? 'border-primary bg-primaryLight' : 'border-transparent'}`}>
                <Text
                  className="text-[14px] font-montserrat-semi text-textPrimary flex-1 mr-3"
                  numberOfLines={2}
                >
                  {type.name}
                </Text>
                <View
                  className={`w-6 h-6 rounded-full items-center justify-center ${
                    type.selected ? 'bg-primary' : 'border-2 border-dividerStrong'
                  }`}
                >
                  {type.selected && <Check size={14} color={LightColors.textInverse} />}
                </View>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>

      {/* Save Button — disabled until the selection actually changes so an
          untouched form doesn't fire a redundant profile write. */}
      <BottomActionBar>
        <Button title="Save Preferences" onPress={handleSave} disabled={!dirty} fullWidth />
      </BottomActionBar>

      <ConfirmModal
        visible={showDiscard}
        title="Discard changes?"
        message="Your edits to preferred errand types haven't been saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setShowDiscard(false);
          leave();
        }}
        onCancel={() => setShowDiscard(false)}
      />
    </View>
  );
}
