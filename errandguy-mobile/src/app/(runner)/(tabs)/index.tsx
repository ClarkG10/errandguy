import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  Platform,
  StatusBar,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import {
  Bell,
  Star,
  ChevronRight,
  Wallet,
  History as HistoryIcon,
  MapPinned,
  ListChecks,
  Power,
  TrendingUp,
  Pencil,
} from 'lucide-react-native';
import { NegotiateOfferCard } from '../../../components/runner/NegotiateOfferCard';
import { VerificationBanner } from '../../../components/runner/VerificationBanner';
import { IncomingRequestModal } from '../../../components/runner/IncomingRequestModal';
import { ActiveRunnerErrandCard } from '../../../components/runner/ActiveRunnerErrandCard';
import { Avatar } from '../../../components/ui/Avatar';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Illustration } from '../../../components/ui/Illustration';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useLocationStore } from '../../../stores/locationStore';
import { ensureLocationPermission, getCurrentCoords } from '../../../utils/locationPermission';
import { runOptimistic } from '../../../utils/optimistic';
import { useAuthStore } from '../../../stores/authStore';
import { useNotificationStore } from '../../../stores/notificationStore';
import { runnerService } from '../../../services/runner.service';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatRelativeTime } from '../../../utils/formatDate';
import { storage } from '../../../utils/storage';
import { RunnerHomeSkeleton } from '../../../components/ui/Skeleton';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { prefetchQuery } from '../../../services/preload.service';
import { useIncomingRequest } from '../../../hooks/useIncomingRequest';
import { useSmartPolling } from '../../../hooks/useSmartPolling';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import type { Booking } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { LightColors, Elevation } from '../../../constants/colors';

/** Whole-peso display for the goal progress line — "₱650 of ₱1,000". */
const pesos = (v: number) => `₱${Math.round(v).toLocaleString('en-PH')}`;

/**
 * Runner Home — radically simplified.
 *
 * Old version stacked: header → verification banner → big online button
 * with huge vertical margin → active errand → snapshot stats card →
 * negotiate offers → recent errands. Six sections plus eyebrows.
 *
 * This version anchors the screen on ONE block: the runner's status.
 * Everything else is treated as supporting context that may or may not
 * be present.
 *
 *   • Top — first-name greeting + bell. One band.
 *   • Verification banner — only when relevant.
 *   • Status hero — combines the online toggle WITH today's earnings
 *     in a single tall card. Going online is the primary job-to-be-done
 *     here; the toggle dominates and the earnings figure rides under
 *     it as the secondary anchor. Lifetime stats (errands, rating,
 *     acceptance) sit as tiny captions below the divider, NOT as a
 *     separate icon-tile row.
 *   • Active errand — only when one exists, full-width.
 *   • Negotiate offers — only when online + offers present.
 *   • Recent — at most 3 hairline rows with a "See all" inline link.
 */
export default function RunnerHomeScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const {
    isOnline,
    toggleOnline,
    currentErrand,
    incomingRequest,
    clearIncomingRequest,
    acceptErrand,
    declineErrand,
    earnings,
    setEarnings,
    runnerProfile,
    setRunnerProfile,
  } = useRunnerStore();
  // Atomic action selectors — a bare useLocationStore() re-renders this whole
  // screen on every GPS tick (locationStore writes currentLocation ~every 6s
  // while online). The action refs are stable, so these never re-render here.
  const startTracking = useLocationStore((s) => s.startTracking);
  const stopTracking = useLocationStore((s) => s.stopTracking);
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  const [togglingOnline, setTogglingOnline] = useState(false);
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);

  // Pulse ring around the power button while online — a quiet "live"
  // signal. Frozen for users with the OS Reduce Motion preference.
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (isOnline && !reduceMotion) {
      pulse.value = 0;
      pulse.value = withRepeat(
        withTiming(1, { duration: 1600, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
  }, [isOnline, reduceMotion, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.3 }],
    opacity: 0.55 * (1 - pulse.value),
  }));

  const checkLocationPermission = useCallback(async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      setLocationGranted(status === 'granted');
    } catch {
      setLocationGranted(false);
    }
  }, []);

  useEffect(() => {
    checkLocationPermission();
  }, [checkLocationPermission]);

  useIncomingRequest(isOnline && user?.id ? user.id : null);

  const userId = user?.id ?? 'anon';
  const role = useAuthStore((s) => s.role);
  const enabled = role === 'runner';

  const profileQ = useQuery<any>(
    ['runner', 'profile', userId],
    async () => (await runnerService.getRunnerProfile()).data.data,
    { staleTime: 60_000, ttl: CacheTTL.LONG, enabled },
  );
  const earningsTodayQ = useQuery<number>(
    ['runner', 'earnings', 'today', userId],
    async () => (await runnerService.getEarnings('today')).data.data?.total_earnings ?? 0,
    { staleTime: 60_000, ttl: CacheTTL.MEDIUM, enabled },
  );
  const earningsWeekQ = useQuery<number>(
    ['runner', 'earnings', 'week', userId],
    async () => (await runnerService.getEarnings('week')).data.data?.total_earnings ?? 0,
    { staleTime: 60_000, ttl: CacheTTL.MEDIUM, enabled },
  );
  const historyQ = useQuery<Booking[]>(
    ['runner', 'errands', 'recent', userId],
    async () => ((await runnerService.getErrandHistory({ page: 1, per_page: 3 })).data.data ?? []) as Booking[],
    { staleTime: 60_000, ttl: CacheTTL.LONG, enabled },
  );
  const offersQ = useQuery<Booking[]>(
    ['runner', 'errand', 'available', userId],
    async () => ((await runnerService.getAvailableErrands()).data.data ?? []) as Booking[],
    { staleTime: 15_000, ttl: CacheTTL.SHORT, enabled: enabled && isOnline },
  );
  const currentErrandQ = useQuery<Booking | null>(
    ['runner', 'errand', 'current', userId],
    async () => ((await runnerService.getCurrentErrand()).data.data ?? null) as Booking | null,
    { staleTime: 30_000, ttl: CacheTTL.SHORT, enabled },
  );

  const recentErrands = (historyQ.data ?? []).slice(0, 3);
  const negotiateOffers = offersQ.data ?? [];
  const activeErrand = currentErrand ?? currentErrandQ.data ?? null;

  // Polling fallback for the matched-but-not-yet-shown booking. See
  // historical notes in git: realtime channel is primary, this
  // 30 s pull is the safety net.
  // Smart poll: only while online + foreground + connected; pauses offline
  // and ticks immediately on reconnect/foreground.
  useSmartPolling(() => currentErrandQ.refresh(), {
    interval: 30_000,
    enabled: enabled && isOnline,
    runOnMount: false,
  });

  const lastSeenMatchIdRef = React.useRef<string | null>(null);
  useEffect(() => {
    const fresh = currentErrandQ.data;
    if (!fresh) return;
    if (fresh.status !== 'matched') return;
    if (currentErrand?.id === fresh.id) return;
    if (incomingRequest?.booking?.id === fresh.id) return;
    if (lastSeenMatchIdRef.current === fresh.id) return;
    lastSeenMatchIdRef.current = fresh.id;
    useRunnerStore.getState().setIncomingRequest({
      booking: fresh,
      expiresAt: Date.now() + 30_000,
    });
  }, [currentErrandQ.data, currentErrand?.id, incomingRequest?.booking?.id]);

  useEffect(() => {
    if (profileQ.data) setRunnerProfile(profileQ.data);
  }, [profileQ.data, setRunnerProfile]);
  useEffect(() => {
    if (earningsTodayQ.data != null) {
      setEarnings({ ...earnings, today: earningsTodayQ.data });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earningsTodayQ.data]);

  // "Updated Xm ago" caption on the hero — stamped whenever the today
  // figure lands successfully. A minute-tick keeps the relative label
  // honest while the screen stays open.
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    if (earningsTodayQ.data != null && !earningsTodayQ.error) {
      setLastUpdatedAt(Date.now());
    }
  }, [earningsTodayQ.data, earningsTodayQ.error]);
  const [, setMinuteTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMinuteTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Daily earnings goal — purely local (AsyncStorage), per account.
  const goalStorageKey = useMemo(() => `@eg_runner_daily_goal:${userId}`, [userId]);
  const [dailyGoal, setDailyGoal] = useState<number | null>(null);
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  useEffect(() => {
    let mounted = true;
    storage
      .get(goalStorageKey)
      .then((v) => {
        if (!mounted) return;
        const n = v != null ? Number(v) : NaN;
        setDailyGoal(Number.isFinite(n) && n > 0 ? n : null);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [goalStorageKey]);

  const openGoalModal = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setGoalInput(dailyGoal ? String(dailyGoal) : '');
    setGoalModalVisible(true);
  }, [dailyGoal]);

  const saveGoal = useCallback(() => {
    const n = Math.round(Number(goalInput.replace(/[^0-9.]/g, '')));
    if (Number.isFinite(n) && n > 0) {
      setDailyGoal(n);
      storage.set(goalStorageKey, String(n)).catch(() => {});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      setDailyGoal(null);
      storage.remove(goalStorageKey).catch(() => {});
    }
    setGoalModalVisible(false);
  }, [goalInput, goalStorageKey]);

  const removeGoal = useCallback(() => {
    setDailyGoal(null);
    storage.remove(goalStorageKey).catch(() => {});
    setGoalModalVisible(false);
  }, [goalStorageKey]);

  const initialLoading =
    enabled && profileQ.loading && historyQ.loading && !profileQ.data && !historyQ.data;

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      profileQ.refresh(),
      earningsTodayQ.refresh(),
      earningsWeekQ.refresh(),
      historyQ.refresh(),
      currentErrandQ.refresh(),
      isOnline ? offersQ.refresh() : Promise.resolve(),
    ]);
    setRefreshing(false);
  }, [profileQ, earningsTodayQ, earningsWeekQ, historyQ, currentErrandQ, offersQ, isOnline]);

  const handleToggleOnline = async (value: boolean) => {
    if (togglingOnline) return;
    // Raw Pressable — medium impact acknowledges the press instantly;
    // the outcome haptics below confirm or reject once the server answers.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    // Going OFFLINE — optimistic instant flip. No GPS/tracking dependency, so
    // turn the ring off + clear the offers list immediately, confirm in the
    // background, and roll back to online if the server rejects. (Going ONLINE
    // stays blocking below — it hard-depends on acquiring GPS + starting
    // tracking, so it must await confirmation.)
    if (!value) {
      // Snapshot the offers so rollback is the exact inverse of apply — if
      // the toggle fails the runner is still online and their open offers
      // must reappear, not stay cleared until the next revalidation.
      const prevOffers = offersQ.data;
      await runOptimistic({
        apply: () => {
          toggleOnline(false);
          offersQ.mutate(() => []);
        },
        rollback: () => {
          toggleOnline(true);
          offersQ.mutate(() => prevOffers ?? []);
        },
        commit: () => runnerService.toggleOnline(false),
        errorMessage: 'Could not go offline. Please try again.',
        onSuccess: () => {
          stopTracking();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          toast.info("You're offline. We'll stop sending you new requests.");
        },
      });
      return;
    }

    if (value) {
      const cachedProfile = profileQ.data ?? runnerProfile;
      if (cachedProfile && (!cachedProfile.preferred_types || cachedProfile.preferred_types.length === 0)) {
        toast.warning(
          'Pick at least one errand type you\u2019d like to receive before going online.',
        );
        router.push('/(runner)/settings/preferred-types' as any);
        return;
      }
      if (cachedProfile && cachedProfile.verification_status && cachedProfile.verification_status !== 'approved') {
        toast.warning('Finish account verification before going online.');
        router.push('/(runner)/settings/documents' as any);
        return;
      }
    }

    setTogglingOnline(true);
    try {
      let coords: { lat: number; lng: number } | undefined;
      if (value) {
        const { currentLocation } = useLocationStore.getState();
        if (currentLocation) {
          coords = { lat: currentLocation.lat, lng: currentLocation.lng };
        } else {
          // Robust fix: permission + timeout + last-known fallback so going
          // online never hangs on weak GPS.
          const pos = await getCurrentCoords({
            feature: 'go online and receive errands',
            accuracy: Location.Accuracy.High,
          });
          if (!pos) {
            setLocationGranted(false);
            toast.error('Could not get your location. Check GPS and try again.');
            return;
          }
          setLocationGranted(true);
          coords = { lat: pos.lat, lng: pos.lng };
        }
      }
      await runnerService.toggleOnline(value, coords);
      toggleOnline(value);
      if (value) {
        const ok = await startTracking();
        if (!ok) {
          try {
            await runnerService.toggleOnline(false);
          } catch {
            /* best-effort rollback */
          }
          toggleOnline(false);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          toast.warning(
            'Couldn\u2019t start location tracking. You\u2019ve been set back to offline \u2014 please check Settings.',
          );
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          toast.success('You\u2019re online and ready for errands.');
        }
      }
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const status = err?.status ?? err?.response?.status;
      const message: string =
        err?.message ?? err?.response?.data?.message ?? 'Failed to toggle status';

      if (status === 422 && /preferred errand type/i.test(message)) {
        toast.warning(
          'Pick at least one errand type you\u2019d like to receive before going online.',
        );
        router.push('/(runner)/settings/preferred-types' as any);
        return;
      }
      if (status === 422 && /verif/i.test(message)) {
        toast.warning('Finish account verification before going online.');
        router.push('/(runner)/settings/documents' as any);
        return;
      }
      if (status === 0) {
        toast.error('No connection. Check your internet and try again.');
        return;
      }
      toast.error(message);
    } finally {
      setTogglingOnline(false);
    }
  };

  const handleAcceptErrand = async () => {
    if (!incomingRequest) return;
    const bookingId = incomingRequest.booking.id;
    try {
      const res = await runnerService.acceptErrand(bookingId);
      // Server-confirmed accept — the success moment for this flow.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const updated = (res?.data?.data ?? incomingRequest.booking) as Booking;
      acceptErrand(updated);
      router.push(`/(runner)/errand/${bookingId}` as any);
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      toast.error(err?.message ?? err?.response?.data?.message ?? 'Failed to accept errand');
      clearIncomingRequest();
    }
  };

  const handleDeclineErrand = () => {
    if (!incomingRequest) return;
    // Dismiss the offer INSTANTLY, then fire the decline in the background.
    // Capture the id before clearing — declineErrand() nulls incomingRequest.
    // No rollback: re-showing a declined offer is worse than a silent miss,
    // and the server auto-expires the 30s offer window regardless.
    const id = incomingRequest.booking.id;
    declineErrand();
    runnerService.declineErrand(id).catch(() => {});
  };

  const verificationStatus = runnerProfile?.verification_status ?? 'pending';
  const firstName = user?.full_name?.split(' ')[0] ?? 'Runner';

  if (initialLoading) {
    return (
      <View className="flex-1 bg-background">
        <RunnerHomeSkeleton />
      </View>
    );
  }

  const todayEarnings = earnings.today ?? 0;
  const weekEarnings = earningsWeekQ.data ?? 0;
  const canGoOnline = verificationStatus === 'approved';

  // Distinguish "failed with nothing cached" from a healthy ₱0.00 —
  // showing zeros over a network error misreads as a bad day.
  const earningsFailed =
    (earningsTodayQ.error != null && earningsTodayQ.data == null) ||
    (earningsWeekQ.error != null && earningsWeekQ.data == null);
  const lifetimeFailed =
    profileQ.error != null && profileQ.data == null && !runnerProfile;

  const statusCaption = !canGoOnline
    ? 'Verification required'
    : isOnline
    ? 'You’re online · receiving requests'
    : locationGranted === false
    ? 'Location off · enable to start'
    : 'Tap the power button to go online';

  const goalProgress =
    dailyGoal != null && dailyGoal > 0
      ? Math.min(1, todayEarnings / dailyGoal)
      : null;

  // "Updated Xm ago" — recomputed on every render; the minute-tick
  // interval above keeps the relative label fresh while the screen
  // stays open. Null figure ⇒ no caption.
  const updatedLabel =
    lastUpdatedAt == null
      ? null
      : Date.now() - lastUpdatedAt < 60_000
      ? 'Updated just now'
      : `Updated ${formatRelativeTime(new Date(lastUpdatedAt))}`;

  return (
    <View className="flex-1 bg-background">
      {Platform.OS === 'ios' && <StatusBar barStyle="dark-content" />}

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={LightColors.textSecondary}
            colors={[LightColors.primary]}
            progressBackgroundColor={LightColors.surface}
          />
        }
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* ==========================================================
            HERO — tokenized greeting header on the canvas, then a
            blue-gradient earnings card ("balance card" pattern from
            the reference designs) that also carries the online-status
            power toggle. The active-errand card (when present) sits
            directly under it so a trip in progress is the first thing
            the runner sees.
            ========================================================== */}
        <View className="bg-background">
          <SafeAreaView edges={['top']}>
            {/* Greeting row */}
            <View className="flex-row items-center px-5 pt-2 pb-3">
              <Pressable
                onPress={() => router.push('/(runner)/(tabs)/profile' as any)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Open profile"
              >
                <Avatar uri={user?.avatar_url} name={user?.full_name} size="sm" />
              </Pressable>
              <View className="flex-1 ml-3">
                <Text className="text-[11px] font-montserrat text-textSecondary">
                  Welcome back
                </Text>
                <Text
                  className="text-[15px] font-montserrat-bold text-textPrimary"
                  numberOfLines={1}
                >
                  {firstName}
                </Text>
              </View>
              <Pressable
                onPress={() => router.push('/(runner)/notifications' as any)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={
                  unreadCount > 0
                    ? `Notifications, ${unreadCount} unread`
                    : 'Notifications'
                }
                className="relative w-10 h-10 items-center justify-center"
              >
                <Bell size={22} color={LightColors.ink} strokeWidth={1.8} />
                {unreadCount > 0 && (
                  <View
                    className="absolute bg-danger"
                    style={{
                      top: 8,
                      right: 8,
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      borderWidth: 1.5,
                      borderColor: LightColors.background,
                    }}
                  />
                )}
              </Pressable>
            </View>

            {/* Earnings hero — blue gradient balance card. Big white
                numerals, week comparison inline below, and the online
                power toggle anchored to the card's right edge. */}
            <View className="px-5 pt-1 pb-5">
              <LinearGradient
                colors={[
                  LightColors.gradientStart,
                  LightColors.gradientMid,
                  LightColors.gradientEnd,
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ borderRadius: 24, padding: 20, ...Elevation.md }}
              >
                <View className="flex-row items-center">
                  <View className="flex-1 pr-4">
                    {earningsFailed ? (
                      // A failed fetch with nothing cached — show an error
                      // affordance on a legible white inset instead of a
                      // misleading ₱0.00.
                      <ErrorState
                        compact
                        onRetry={onRefresh}
                        title="Couldn't load your earnings"
                        style={{
                          backgroundColor: LightColors.surface,
                          borderRadius: 16,
                          padding: 12,
                        }}
                      />
                    ) : (
                      <>
                        <Text
                          className="text-[10px] font-montserrat-bold uppercase text-white/80"
                          style={{ letterSpacing: 1.6 }}
                        >
                          Today's earnings
                        </Text>
                        <Text
                          className="font-inter-semi tabular-nums text-white mt-1"
                          style={{ fontSize: 38, lineHeight: 44, letterSpacing: -1 }}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.7}
                        >
                          {formatCurrency(todayEarnings)}
                        </Text>
                        {updatedLabel ? (
                          <Text className="text-[10px] font-montserrat text-white/60 mt-0.5">
                            {updatedLabel}
                          </Text>
                        ) : null}
                        <View className="flex-row items-center mt-2">
                          <TrendingUp
                            size={12}
                            color="rgba(255,255,255,0.8)"
                            strokeWidth={2}
                          />
                          <Text className="text-[12px] font-montserrat text-white/90 ml-1.5">
                            This week ·{' '}
                            <Text className="font-montserrat-bold tabular-nums text-white">
                              {formatCurrency(weekEarnings)}
                            </Text>
                          </Text>
                        </View>
                      </>
                    )}
                  </View>

                  {/* Online-status toggle — prominence tracks "live": ONLINE
                      is the dominant solid-white disc (blue glyph) with a
                      pulse halo, OFFLINE is the quieter outlined translucent
                      disc that reads as "tap to go online", and a baked-in
                      GO/ONLINE label makes the state readable at a glance in
                      sunlight without parsing the caption below. Pulse frozen
                      for Reduce Motion. */}
                  <View className="items-center" style={{ width: 80 }}>
                    <View
                      className="items-center justify-center"
                      style={{ width: 72, height: 72 }}
                    >
                      {isOnline && !reduceMotion ? (
                        <Animated.View
                          pointerEvents="none"
                          style={[
                            {
                              position: 'absolute',
                              width: 72,
                              height: 72,
                              borderRadius: 36,
                              backgroundColor: 'rgba(255,255,255,0.5)',
                            },
                            pulseStyle,
                          ]}
                        />
                      ) : null}
                      <Pressable
                        onPress={() => handleToggleOnline(!isOnline)}
                        disabled={togglingOnline || !canGoOnline}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !canGoOnline, busy: togglingOnline }}
                        accessibilityLabel={
                          !canGoOnline
                            ? 'Verification required'
                            : isOnline
                            ? 'Go offline'
                            : 'Go online'
                        }
                        className="items-center justify-center rounded-full"
                        style={{
                          width: 72,
                          height: 72,
                          backgroundColor: !canGoOnline
                            ? 'rgba(255,255,255,0.12)'
                            : isOnline
                            ? LightColors.surface
                            : 'rgba(255,255,255,0.14)',
                          borderWidth: !canGoOnline ? 0 : isOnline ? 0 : 1.5,
                          borderColor: 'rgba(255,255,255,0.6)',
                          opacity: togglingOnline ? 0.7 : 1,
                        }}
                      >
                        <Power
                          size={30}
                          color={
                            !canGoOnline
                              ? 'rgba(255,255,255,0.5)'
                              : isOnline
                              ? LightColors.primary
                              : LightColors.textInverse
                          }
                          strokeWidth={2.4}
                        />
                      </Pressable>
                    </View>
                    {canGoOnline ? (
                      <Text
                        className="text-[11px] font-montserrat-bold text-white mt-1.5"
                        style={{ letterSpacing: 1 }}
                      >
                        {isOnline ? 'ONLINE' : 'GO'}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {/* Daily earnings goal — progress toward a locally-set
                    target when one exists, otherwise a quiet affordance
                    to set one. Suppressed when the earnings fetch failed:
                    it must never assert "₱0 of goal" while the number above
                    says it couldn't load. */}
                {!earningsFailed && (dailyGoal != null && goalProgress != null ? (
                  <View className="mt-4">
                    <View className="flex-row items-center justify-between mb-1.5">
                      <Text className="text-[11px] font-inter-semi text-white/90 tabular-nums">
                        {pesos(todayEarnings)} of {pesos(dailyGoal)} goal
                      </Text>
                      <Pressable
                        onPress={openGoalModal}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel="Edit daily goal"
                        className="items-center justify-center rounded-full"
                        style={{
                          width: 28,
                          height: 28,
                          backgroundColor: 'rgba(255,255,255,0.16)',
                        }}
                      >
                        <Pencil size={13} color={LightColors.textInverse} strokeWidth={2} />
                      </Pressable>
                    </View>
                    <View
                      className="overflow-hidden"
                      style={{
                        height: 6,
                        borderRadius: 999,
                        backgroundColor: 'rgba(255,255,255,0.22)',
                      }}
                    >
                      <View
                        style={{
                          height: 6,
                          borderRadius: 999,
                          width: `${Math.max(0, Math.min(1, goalProgress)) * 100}%`,
                          backgroundColor: LightColors.textInverse,
                        }}
                      />
                    </View>
                    {goalProgress >= 1 ? (
                      <Text className="text-[10px] font-montserrat-bold text-white mt-1.5">
                        Daily goal reached
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <Pressable
                    onPress={openGoalModal}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Set a daily goal"
                    className="flex-row items-center mt-4"
                  >
                    <Pencil size={12} color={LightColors.textInverse} strokeWidth={2} />
                    <Text className="text-[11px] font-montserrat-bold text-white ml-1.5 underline">
                      Set a daily goal
                    </Text>
                  </Pressable>
                ))}
                {/* Status caption — quiet, rides on the card */}
                <View className="flex-row items-center mt-4 pt-3 border-t border-white/20">
                  <View
                    className="rounded-full"
                    style={{
                      width: 6,
                      height: 6,
                      backgroundColor: isOnline
                        ? LightColors.success
                        : 'rgba(255,255,255,0.6)',
                      marginRight: 6,
                    }}
                  />
                  <Text className="text-[11px] font-montserrat text-white">
                    {statusCaption}
                  </Text>
                </View>
              </LinearGradient>
            </View>
          </SafeAreaView>
        </View>

        {/* Verification banner — overlaps the bottom of the hero so it
            reads as a top-priority blocker, not an afterthought. */}
        {!canGoOnline && (
          // VerificationBanner owns its own mx-5 gutter — a wrapper px-5
          // here would double it and shrink the banner below the block width.
          <View className="-mt-3">
            <VerificationBanner
              status={verificationStatus}
              onAction={() => router.push('/(runner)/settings/documents' as any)}
            />
          </View>
        )}

        {/* Location permission nudge — only when needed and only when
            verified (otherwise verification banner is the priority). */}
        {canGoOnline && locationGranted === false && (
          <View className="mx-5 -mt-3 mb-4 bg-warning/10 border border-warning/30 rounded-2xl px-4 py-3 flex-row items-center">
            <View className="flex-1 mr-3">
              <Text className="text-[12px] font-montserrat-bold text-warningDark">
                Turn on location
              </Text>
              <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">
                Customers can&apos;t see you on the map without it.
              </Text>
            </View>
            <Pressable
              onPress={async () => {
                const ok = await ensureLocationPermission({ feature: 'appear on the map for customers' });
                setLocationGranted(ok);
              }}
              accessibilityRole="button"
              accessibilityLabel="Enable location"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              className="px-3 rounded-xl bg-warningDark items-center justify-center"
              style={({ pressed }) => ({
                minHeight: 36,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text className="text-[11px] font-montserrat-bold text-white">
                Enable
              </Text>
            </Pressable>
          </View>
        )}

        {/* Active errand — the hero card that floats over everything
            else when a trip is in progress. */}
        {activeErrand && (
          <View className="px-5 pt-5">
            <ActiveRunnerErrandCard
              errand={activeErrand}
              onPress={() =>
                router.push(`/(runner)/errand/${activeErrand.id}` as any)
              }
            />
          </View>
        )}

        {/* Idle state — nothing in progress. A calm illustration fills the
            area under the toggle: OFFLINE nudges the runner to go online,
            ONLINE-with-no-offers reassures that we're listening. Only for
            verified runners with no active errand (verification banner and
            active-errand card take priority otherwise). */}
        {canGoOnline && !activeErrand && (!isOnline || negotiateOffers.length === 0) && (
          <View className="px-5 pt-8 items-center">
            <Illustration
              name={isOnline ? 'runner-no-jobs' : 'runner-offline'}
              size={180}
            />
            <Text className="text-[15px] font-montserrat-bold text-textPrimary mt-4">
              {isOnline ? 'Waiting for requests' : "You're offline"}
            </Text>
            <Text className="text-[12px] font-montserrat text-textSecondary mt-1 text-center px-6">
              {isOnline
                ? 'Sit tight — we’ll ping you the moment a nearby errand comes in.'
                : 'Tap the power button above to start receiving errands.'}
            </Text>
          </View>
        )}

        {/* Performance strip — three calm metrics inside hairline borders
            so the screen has rhythm without another card. */}
        <View className="px-5 pt-6">
          <Text
            className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-2"
            style={{ letterSpacing: 1.4 }}
          >
            Lifetime
          </Text>
          {lifetimeFailed ? (
            <ErrorState compact onRetry={onRefresh} title="Couldn't load your stats" />
          ) : (
          <View className="flex-row py-4 border-y border-divider">
            <View className="flex-1 items-center">
              <Text
                className="text-[20px] font-inter-semi tabular-nums text-textPrimary"
                style={{ letterSpacing: -0.3 }}
              >
                {runnerProfile?.total_errands ?? 0}
              </Text>
              <Text
                className="text-[10px] font-montserrat uppercase text-textSecondary mt-1"
                style={{ letterSpacing: 1 }}
              >
                Errands
              </Text>
            </View>
            <View className="w-px bg-divider" />
            <View className="flex-1 items-center">
              <View className="flex-row items-center">
                <Text
                  className="text-[20px] font-inter-semi tabular-nums text-textPrimary"
                  style={{ letterSpacing: -0.3 }}
                >
                  {Number(user?.avg_rating ?? 0).toFixed(1)}
                </Text>
                <Star
                  size={13}
                  color={LightColors.warning}
                  fill={LightColors.warning}
                  style={{ marginLeft: 4 }}
                />
              </View>
              <Text
                className="text-[10px] font-montserrat uppercase text-textSecondary mt-1"
                style={{ letterSpacing: 1 }}
              >
                Rating
              </Text>
            </View>
            <View className="w-px bg-divider" />
            <View className="flex-1 items-center">
              <Text
                className="text-[20px] font-inter-semi tabular-nums text-textPrimary"
                style={{ letterSpacing: -0.3 }}
              >
                {Math.round(runnerProfile?.acceptance_rate ?? 0)}%
              </Text>
              <Text
                className="text-[10px] font-montserrat uppercase text-textSecondary mt-1"
                style={{ letterSpacing: 1 }}
              >
                Acceptance
              </Text>
            </View>
          </View>
          )}
        </View>

        {/* Open offers — only when online and offers exist. */}
        {isOnline && negotiateOffers.length > 0 && (
          <View className="px-5 pt-6">
            <View className="flex-row items-baseline justify-between mb-2">
              <Text
                className="text-[10px] font-montserrat-bold uppercase text-textSecondary"
                style={{ letterSpacing: 1.4 }}
              >
                Open offers
              </Text>
              <Text
                className="text-[10px] font-montserrat-bold text-primary tabular-nums"
                style={{ letterSpacing: 1.2 }}
              >
                {negotiateOffers.length} WAITING
              </Text>
            </View>
            {negotiateOffers.map((offer) => (
              <NegotiateOfferCard
                key={offer.id}
                booking={offer}
                onPress={() => {
                  // Warm the errand detail before navigating so the screen
                  // paints from cache instead of a skeleton.
                  prefetchQuery(
                    ['runner', 'errand', 'byId', offer.id],
                    async () => (await runnerService.getErrand(offer.id)).data?.data ?? null,
                    CacheTTL.SHORT,
                  );
                  router.push(`/(runner)/errand/${offer.id}` as any);
                }}
              />
            ))}
          </View>
        )}

        {/* Shortcuts — 2x2 grid */}
        <View className="px-5 pt-6">
          <Text
            className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-3"
            style={{ letterSpacing: 1.4 }}
          >
            Shortcuts
          </Text>
          <View className="flex-row flex-wrap" style={{ marginHorizontal: -6 }}>
            {[
              { label: 'Earnings', Icon: Wallet, route: '/(runner)/(tabs)/earnings' },
              { label: 'History', Icon: HistoryIcon, route: '/(runner)/(tabs)/history' },
              { label: 'Busy areas', Icon: TrendingUp, route: '/(runner)/demand' },
              { label: 'Areas', Icon: MapPinned, route: '/(runner)/settings/working-areas' },
              { label: 'Errand types', Icon: ListChecks, route: '/(runner)/settings/preferred-types' },
            ].map(({ label, Icon, route }) => (
              <View
                key={label}
                style={{ width: '50%', paddingHorizontal: 6, paddingBottom: 12 }}
              >
                <Pressable
                  onPress={() => router.push(route as any)}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  className="bg-surface px-4 py-4 rounded-2xl border border-divider flex-row items-center"
                >
                  <View className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center mr-3">
                    <Icon size={18} color={LightColors.primary} strokeWidth={1.8} />
                  </View>
                  <Text
                    className="flex-1 text-[13px] font-montserrat-bold text-textPrimary"
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                  <ChevronRight size={14} color={LightColors.textMuted} />
                </Pressable>
              </View>
            ))}
          </View>
        </View>

        {/* Recent — at most 3 hairline rows */}
        {recentErrands.length > 0 && (
          <View className="px-5 pt-4">
            <View className="flex-row items-baseline justify-between mb-1">
              <Text
                className="text-[10px] font-montserrat-bold uppercase text-textSecondary"
                style={{ letterSpacing: 1.4 }}
              >
                Recent
              </Text>
              <Pressable
                onPress={() => router.push('/(runner)/(tabs)/history' as any)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="See all errands"
              >
                <Text className="text-[11px] font-montserrat-bold text-primary underline">
                  See all
                </Text>
              </Pressable>
            </View>
            {recentErrands.map((errand, idx) => (
              <Pressable
                key={errand.id}
                className="flex-row items-center py-3.5"
                style={
                  idx < recentErrands.length - 1
                    ? { borderBottomWidth: 1, borderBottomColor: LightColors.divider }
                    : undefined
                }
                onPress={() => router.push(`/(runner)/errand/${errand.id}` as any)}
                accessibilityRole="button"
                accessibilityLabel={`${errand.errand_type?.name ?? 'Errand'}, ${formatCurrency(errand.runner_payout ?? errand.total_amount)}`}
              >
                <View className="flex-1 mr-3">
                  <Text
                    className="text-[14px] font-montserrat-bold text-textPrimary"
                    numberOfLines={1}
                  >
                    {errand.errand_type?.name ?? 'Errand'}
                  </Text>
                  {errand.distance_km ? (
                    <Text className="text-[11px] font-inter tabular-nums text-textSecondary mt-0.5">
                      {errand.distance_km} km
                    </Text>
                  ) : null}
                </View>
                <Text className="text-[14px] font-inter-semi tabular-nums text-textPrimary">
                  {formatCurrency(errand.runner_payout ?? errand.total_amount)}
                </Text>
                <ChevronRight size={16} color={LightColors.textMuted} style={{ marginLeft: 8 }} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {incomingRequest && (
        <IncomingRequestModal
          booking={incomingRequest.booking}
          onAccept={handleAcceptErrand}
          onDecline={handleDeclineErrand}
          timeoutSeconds={30}
        />
      )}

      {/* Daily goal editor — bottom sheet, mirrors the delete-account
          modal language elsewhere in the app. */}
      <Modal
        visible={goalModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setGoalModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable
            className="flex-1 bg-black/40 justify-end"
            accessibilityRole="button"
            accessibilityLabel="Dismiss daily goal editor"
            onPress={() => setGoalModalVisible(false)}
          >
            <Pressable
              className="bg-surface px-7 pt-6 pb-12"
              accessible={false}
              onPress={() => {}}
            >
              <View className="w-10 h-1 rounded-full bg-divider self-center mb-5" />
              <Text className="text-base font-montserrat-bold text-textPrimary mb-1">
                {dailyGoal ? 'Edit daily goal' : 'Set a daily goal'}
              </Text>
              <Text className="text-sm font-montserrat text-textTertiary mb-5">
                We&apos;ll show your progress toward this on your dashboard each day.
              </Text>
              <Text className="text-xs font-montserrat-bold text-textSecondary mb-2">
                Daily goal (₱)
              </Text>
              <View className="border border-divider rounded-xl px-4 h-12 justify-center mb-5 bg-background">
                <TextInput
                  value={goalInput}
                  onChangeText={setGoalInput}
                  placeholder="1,000"
                  placeholderTextColor={LightColors.textMuted}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  returnKeyType="done"
                  onSubmitEditing={saveGoal}
                  accessibilityLabel="Daily earnings goal in pesos"
                  style={{
                    fontFamily: 'Quicksand_400Regular',
                    fontSize: 15,
                    color: LightColors.textPrimary,
                  }}
                />
              </View>
              <Button title="Save goal" fullWidth onPress={saveGoal} />
              {dailyGoal ? (
                <Pressable
                  className="mt-3 py-3 items-center"
                  accessibilityRole="button"
                  accessibilityLabel="Remove daily goal"
                  onPress={removeGoal}
                >
                  <Text className="text-sm font-montserrat-bold text-danger">
                    Remove goal
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                className="mt-1 py-3 items-center"
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                onPress={() => setGoalModalVisible(false)}
              >
                <Text className="text-sm font-montserrat-bold text-textTertiary">
                  Cancel
                </Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}


