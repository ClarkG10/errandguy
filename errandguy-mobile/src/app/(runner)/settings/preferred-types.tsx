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
import { useRunnerStore } from '../../../stores/runnerStore';
import { runnerService } from '../../../services/runner.service';
import { runOptimistic } from '../../../utils/optimistic';
import { toast } from '../../../stores/toastStore';

interface ErrandTypeOption {
  id: string;
  slug: string;
  name: string;
  selected: boolean;
}

export default function PreferredTypesScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { contentMaxWidth } = useResponsive();
  const { runnerProfile, setRunnerProfile } = useRunnerStore();

  const [types, setTypes] = useState<ErrandTypeOption[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);

  // Common errand types (would normally come from API)
  const defaultTypes = [
    { id: '1', slug: 'delivery', name: 'Delivery' },
    { id: '2', slug: 'purchase', name: 'Purchase & Deliver' },
    { id: '3', slug: 'transportation', name: 'Transportation' },
    { id: '4', slug: 'document', name: 'Document Processing' },
    { id: '5', slug: 'queue', name: 'Queue & Wait' },
    { id: '6', slug: 'moving', name: 'Moving Assistance' },
  ];

  useEffect(() => {
    const preferred = runnerProfile?.preferred_types ?? [];
    setTypes(
      defaultTypes.map((t) => ({
        ...t,
        selected: preferred.includes(t.slug),
      })),
    );
  }, [runnerProfile]);

  const toggleType = (slug: string) => {
    Haptics.selectionAsync().catch(() => {});
    setTypes((prev) =>
      prev.map((t) => (t.slug === slug ? { ...t, selected: !t.selected } : t)),
    );
  };

  const handleSave = async () => {
    const selected = types.filter((t) => t.selected).map((t) => t.slug);
    if (selected.length === 0) {
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
    await runOptimistic({
      apply: () => {
        if (runnerProfile) setRunnerProfile({ ...runnerProfile, preferred_types: selected });
      },
      rollback: () => setRunnerProfile(prev),
      commit: () => runnerService.updateRunnerProfile({ preferred_types: selected }),
      errorMessage: "Couldn't update your errand types.",
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        toast.success('Preferred errand types updated');
      },
    });
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await runnerService.getRunnerProfile();
      setRunnerProfile(res.data.data);
    } catch {}
    setRefreshing(false);
  }, []);

  const selectedCount = types.filter((t) => t.selected).length;

  // Dirty = current selection differs from the persisted profile set, so
  // Save can be disabled on a no-op edit and backing out mid-edit prompts
  // a discard confirm instead of silently dropping the change.
  const initialSet = useMemo(
    () => new Set(runnerProfile?.preferred_types ?? []),
    [runnerProfile],
  );
  const dirty = useMemo(() => {
    const selected = types.filter((t) => t.selected);
    return (
      selected.length !== initialSet.size ||
      selected.some((t) => !initialSet.has(t.slug))
    );
  }, [types, initialSet]);

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
        {types.map((type) => (
          <Pressable
            key={type.slug}
            onPress={() => toggleType(type.slug)}
            accessibilityRole="checkbox"
            accessibilityLabel={type.name}
            accessibilityState={{ checked: type.selected }}
          >
            <Card className={`mb-2 p-4 flex-row items-center justify-between border ${type.selected ? 'border-primary bg-primaryLight' : 'border-transparent'}`}>
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">
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
        ))}
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
