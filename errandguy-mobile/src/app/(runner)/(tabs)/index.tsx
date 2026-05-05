import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  StyleSheet,
  Platform,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
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
} from 'lucide-react-native';
import { NegotiateOfferCard } from '../../../components/runner/NegotiateOfferCard';
import { VerificationBanner } from '../../../components/runner/VerificationBanner';
import { IncomingRequestModal } from '../../../components/runner/IncomingRequestModal';
import { ActiveRunnerErrandCard } from '../../../components/runner/ActiveRunnerErrandCard';
import { Avatar } from '../../../components/ui/Avatar';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useLocationStore } from '../../../stores/locationStore';
import { useAuthStore } from '../../../stores/authStore';
import { useNotificationStore } from '../../../stores/notificationStore';
import { runnerService } from '../../../services/runner.service';
import { formatCurrency } from '../../../utils/formatCurrency';
import { RunnerHomeSkeleton } from '../../../components/ui/Skeleton';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { useIncomingRequest } from '../../../hooks/useIncomingRequest';
import { useForegroundInterval } from '../../../hooks/useForegroundInterval';
import type { Booking } from '../../../types';
import { toast } from '../../../stores/toastStore';

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
  const { startTracking, stopTracking } = useLocationStore();
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  const [togglingOnline, setTogglingOnline] = useState(false);
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);

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
  useForegroundInterval(
    () => {
      if (!enabled || !isOnline) return;
      currentErrandQ.refresh();
    },
    30_000,
    enabled && isOnline,
    false,
  );

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

  const initialLoading =
    enabled && profileQ.loading && historyQ.loading && !profileQ.data && !historyQ.data;

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      profileQ.refresh(),
      earningsTodayQ.refresh(),
      historyQ.refresh(),
      currentErrandQ.refresh(),
      isOnline ? offersQ.refresh() : Promise.resolve(),
    ]);
    setRefreshing(false);
  }, [profileQ, earningsTodayQ, historyQ, currentErrandQ, offersQ, isOnline]);

  const handleToggleOnline = async (value: boolean) => {
    if (togglingOnline) return;

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
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status !== 'granted') {
            const req = await Location.requestForegroundPermissionsAsync();
            if (req.status !== 'granted') {
              setLocationGranted(false);
              toast.warning(
                'Location permission is required to go online. Enable it in Settings to start receiving errands.',
              );
              return;
            }
            setLocationGranted(true);
          }
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
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
          toast.warning(
            'Couldn\u2019t start location tracking. You\u2019ve been set back to offline \u2014 please check Settings.',
          );
        } else {
          toast.success('You\u2019re online and ready for errands.');
        }
      } else {
        stopTracking();
        offersQ.mutate(() => []);
        toast.info('You\u2019re offline. We\u2019ll stop sending you new requests.');
      }
    } catch (err: any) {
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
      const updated = (res?.data?.data ?? incomingRequest.booking) as Booking;
      acceptErrand(updated);
      router.push(`/(runner)/errand/${bookingId}` as any);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to accept errand');
      clearIncomingRequest();
    }
  };

  const handleDeclineErrand = async () => {
    if (!incomingRequest) return;
    try {
      await runnerService.declineErrand(incomingRequest.booking.id);
    } catch {
      // decline best effort
    }
    declineErrand();
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

  return (
    <View className="flex-1 bg-background">
      {Platform.OS === 'ios' && <StatusBar barStyle="light-content" />}

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#FFFFFF"
            colors={['#2563EB']}
            progressBackgroundColor="#1D4ED8"
          />
        }
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* ==========================================================
            HERO — bold blue gradient, runs from top to ~360px tall.
            Contains greeting row, the huge today-earnings figure with
            week subtotal, and a primary "Go Online / Go Offline" CTA
            anchored to the bottom of the gradient. The active-errand
            card (when present) floats up over the gradient's bottom
            edge so the trip in progress is the very first thing the
            runner sees.
            ========================================================== */}
        <LinearGradient
          colors={['#1D4ED8', '#2563EB', '#3B82F6']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={hs.heroGradient}
        >
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
                <Text
                  className="text-[11px] font-montserrat"
                  style={{ color: 'rgba(255,255,255,0.8)' }}
                >
                  Welcome back
                </Text>
                <Text
                  className="text-[15px] font-montserrat-bold text-white"
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
                <Bell size={22} color="#FFFFFF" strokeWidth={1.8} />
                {unreadCount > 0 && (
                  <View
                    className="absolute"
                    style={{
                      top: 8,
                      right: 8,
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: '#F87171',
                      borderWidth: 1.5,
                      borderColor: '#1D4ED8',
                    }}
                  />
                )}
              </Pressable>
            </View>

            {/* HUGE today earnings — the entire reason a runner opens
                this app. Big numerals, tiny eyebrow, week comparison
                inline below so they read context without a second card. */}
            <View className="px-5 pt-3 pb-5">
              <Text
                className="text-[10px] font-montserrat-bold uppercase"
                style={{ letterSpacing: 1.6, color: 'rgba(255,255,255,0.78)' }}
              >
                Today's earnings
              </Text>
              <Text
                className="text-white font-inter-semi tabular-nums mt-1"
                style={{
                  fontSize: 44,
                  lineHeight: 48,
                  letterSpacing: -1.2,
                }}
              >
                {formatCurrency(todayEarnings)}
              </Text>
              <View className="flex-row items-center mt-2">
                <TrendingUp
                  size={12}
                  color="rgba(255,255,255,0.85)"
                  strokeWidth={2}
                />
                <Text
                  className="text-[12px] font-montserrat ml-1.5"
                  style={{ color: 'rgba(255,255,255,0.85)' }}
                >
                  This week ·{' '}
                  <Text className="font-montserrat-bold tabular-nums">
                    {formatCurrency(weekEarnings)}
                  </Text>
                </Text>
              </View>
            </View>

            {/* Primary CTA — icon-only circular power button. The
                action is so well-known (and there are only two states)
                that the label is redundant; the colour and icon alone
                carry the meaning. White circle when offline, dark
                slate when online, muted translucent when verification
                is pending. */}
            <View className="items-center pb-6">
              <Pressable
                onPress={() => handleToggleOnline(!isOnline)}
                disabled={togglingOnline || !canGoOnline}
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
                  width: 96,
                  height: 96,
                  backgroundColor: !canGoOnline
                    ? 'rgba(255,255,255,0.18)'
                    : isOnline
                    ? 'rgba(15,23,42,0.92)'
                    : '#FFFFFF',
                  opacity: togglingOnline ? 0.7 : 1,
                  shadowColor: '#000',
                  shadowOpacity: 0.22,
                  shadowRadius: 14,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 8,
                }}
              >
                <Power
                  size={42}
                  color={
                    !canGoOnline
                      ? '#FFFFFF'
                      : isOnline
                      ? '#FFFFFF'
                      : '#2563EB'
                  }
                  strokeWidth={2.2}
                />
              </Pressable>
              {/* Status caption under the CTA — quiet, white-on-blue */}
              {canGoOnline ? (
                <View className="flex-row items-center justify-center mt-3">
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: isOnline
                        ? '#34D399'
                        : 'rgba(255,255,255,0.55)',
                      marginRight: 6,
                    }}
                  />
                  <Text
                    className="text-[11px] font-montserrat"
                    style={{ color: 'rgba(255,255,255,0.9)' }}
                  >
                    {isOnline
                      ? 'You\u2019re online \u00b7 receiving requests'
                      : locationGranted === false
                      ? 'Location off \u00b7 enable to start'
                      : 'Tap to go online'}
                  </Text>
                </View>
              ) : (
                <Text
                  className="text-[11px] font-montserrat mt-3"
                  style={{ color: 'rgba(255,255,255,0.85)' }}
                >
                  Verification required
                </Text>
              )}
            </View>
          </SafeAreaView>
        </LinearGradient>

        {/* Verification banner — overlaps the bottom of the hero so it
            reads as a top-priority blocker, not an afterthought. */}
        {!canGoOnline && (
          <View className="px-5 -mt-3">
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
              <Text className="text-[12px] font-montserrat-bold text-warning">
                Turn on location
              </Text>
              <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">
                Customers can&apos;t see you on the map without it.
              </Text>
            </View>
            <Pressable
              onPress={async () => {
                const req = await Location.requestForegroundPermissionsAsync();
                setLocationGranted(req.status === 'granted');
                if (req.status !== 'granted') {
                  toast.warning(
                    'Permission still off. Open device Settings to allow location for ErrandGuy.',
                  );
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="Enable location"
              className="px-3 py-2 rounded-xl bg-warning"
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

        {/* Performance strip — three calm metrics inside hairline borders
            so the screen has rhythm without another card. */}
        <View className="px-5 pt-6">
          <Text
            className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-2"
            style={{ letterSpacing: 1.4 }}
          >
            Lifetime
          </Text>
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
                <Star size={13} color="#F59E0B" fill="#F59E0B" style={{ marginLeft: 4 }} />
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
                onPress={() => router.push(`/(runner)/errand/${offer.id}` as any)}
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
                  <Icon size={18} color="#475569" strokeWidth={1.8} style={{ marginRight: 12 }} />
                  <Text
                    className="flex-1 text-[13px] font-montserrat-bold text-textPrimary"
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                  <ChevronRight size={14} color="#CBD5E1" />
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
                    ? { borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }
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
                <ChevronRight size={16} color="#CBD5E1" style={{ marginLeft: 8 }} />
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
    </View>
  );
}

const hs = StyleSheet.create({
  heroGradient: {
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
  },
});

