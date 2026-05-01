import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Bell, Handshake, Star } from 'lucide-react-native';
import { OnlineButton } from '../../../components/runner/OnlineButton';
import { NegotiateOfferCard } from '../../../components/runner/NegotiateOfferCard';
import { VerificationBanner } from '../../../components/runner/VerificationBanner';
import { IncomingRequestModal } from '../../../components/runner/IncomingRequestModal';
import { ActiveRunnerErrandCard } from '../../../components/runner/ActiveRunnerErrandCard';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
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

  // Loading state for the big online button so the runner sees clear
  // feedback while the toggle round-trips to the server (~300–1500ms).
  const [togglingOnline, setTogglingOnline] = useState(false);
  // Track foreground location permission status so we can surface a
  // contextual hint + a one-tap "Enable" button on the home screen.
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

  // Subscribe to incoming booking requests via Supabase Realtime
  useIncomingRequest(isOnline && user?.id ? user.id : null);

  const userId = user?.id ?? 'anon';
  const role = useAuthStore((s) => s.role);
  const enabled = role === 'runner';

  // ── SWR queries (cache-first) ──
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
  const historyQ = useQuery<Booking[]>(
    ['runner', 'errands', 'recent', userId],
    async () => ((await runnerService.getErrandHistory({ page: 1, per_page: 5 })).data.data ?? []) as Booking[],
    { staleTime: 60_000, ttl: CacheTTL.LONG, enabled },
  );
  const offersQ = useQuery<Booking[]>(
    ['runner', 'errand', 'available', userId],
    async () => ((await runnerService.getAvailableErrands()).data.data ?? []) as Booking[],
    { staleTime: 15_000, ttl: CacheTTL.SHORT, enabled: enabled && isOnline },
  );
  // Hydrate the in-flight errand on mount so a cold app launch mid-errand
  // immediately shows the runner what they're working on. Without this the
  // runner used to have to navigate to the Errands tab after every kill.
  // The endpoint already has a 5 s server-side cache; we layer 30 s
  // staleTime on top so navigating away and back is free.
  const currentErrandQ = useQuery<Booking | null>(
    ['runner', 'errand', 'current', userId],
    async () => ((await runnerService.getCurrentErrand()).data.data ?? null) as Booking | null,
    { staleTime: 30_000, ttl: CacheTTL.SHORT, enabled },
  );

  const recentErrands = historyQ.data ?? [];
  const negotiateOffers = offersQ.data ?? [];
  // Prefer the realtime store value (already updated by acceptErrand /
  // status pushes) when available; fall back to the cached fetch result.
  const activeErrand = currentErrand ?? currentErrandQ.data ?? null;

  // Polling fallback for the match handshake. Supabase Realtime is the
  // primary path (useIncomingRequest below) but it can silently drop —
  // RLS misconfig, websocket eviction on cellular handoff, table not
  // in the realtime publication, etc. — and a runner who never sees
  // their match is the worst possible failure mode here. Re-fetching
  // /runner/errand/current every 8s while online catches anything the
  // realtime channel missed.
  useForegroundInterval(
    () => {
      if (!enabled || !isOnline) return;
      currentErrandQ.refresh();
    },
    8_000,
    enabled && isOnline,
    false,
  );

  // When the polled current-errand reveals a fresh match the runner
  // hasn't been told about yet, surface it as an incoming request so
  // the IncomingRequestModal opens. Guarded so we don't re-pop after
  // the runner accepts (status flips to 'accepted') or after a manual
  // dismiss within the same booking id.
  const lastSeenMatchIdRef = React.useRef<string | null>(null);
  useEffect(() => {
    const fresh = currentErrandQ.data;
    if (!fresh) return;
    if (fresh.status !== 'matched') return;
    if (currentErrand?.id === fresh.id) return; // already accepted in store
    if (incomingRequest?.booking?.id === fresh.id) return;
    if (lastSeenMatchIdRef.current === fresh.id) return;
    lastSeenMatchIdRef.current = fresh.id;
    useRunnerStore.getState().setIncomingRequest({
      booking: fresh,
      expiresAt: Date.now() + 30_000,
    });
  }, [currentErrandQ.data, currentErrand?.id, incomingRequest?.booking?.id]);

  // Mirror into the global store so other screens see fresh data.
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

    // ─ Pre-flight using the cached runner profile ─
    // Avoids a guaranteed-to-fail PUT /runner/online when the runner
    // hasn't picked any preferred errand types yet (the backend would
    // 422 with "Please set at least one preferred errand type...").
    // We trust the cached profile; if it's stale, the worst case is
    // we let the request through and surface the same toast anyway.
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
          // Fail closed if foreground permission isn't granted — going
          // online without GPS makes the runner invisible to the
          // matcher (current_lat/lng would be null) and we'd silently
          // burn battery polling toggleOnline endpoints. Better to
          // surface a clear, actionable message and bail before we
          // touch the server.
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
          // Background tracking failed after we flipped online server-side.
          // Roll back so we don't leave the runner in an "online but
          // unreachable" zombie state — the matcher would never see them
          // and they'd wonder why no errands are coming in.
          try {
            await runnerService.toggleOnline(false);
          } catch {
            /* best-effort rollback */
          }
          toggleOnline(false);
          toast.warning(
            'Couldn\u2019t start location tracking. You\u2019ve been set back to offline — please check Settings.',
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

      // Map known 422 backend rules to actionable, user-friendly toasts
      // so the runner knows exactly what to do next instead of seeing
      // a raw API error like "Please set at least one preferred errand type".
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
      // Trust the server response — it returns the freshly-updated
      // booking with status='accepted', accepted_at, runner_id, etc.
      // Falling back to the stale modal payload would leave the runner
      // looking at status='matched' with no action button.
      const res = await runnerService.acceptErrand(bookingId);
      const updated = (res?.data?.data ?? incomingRequest.booking) as Booking;
      acceptErrand(updated);
      // Push them straight onto the active errand screen so they see
      // the route + “Head to pickup” CTA without an extra tap. Without
      // this, the runner sat on the dashboard with the modal closed
      // and no obvious next step.
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

  if (initialLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        <RunnerHomeSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-2 pb-1">
        <View>
          <Text className="text-[11px] font-montserrat text-textTertiary">
            Dashboard
          </Text>
          <Text className="text-base font-montserrat-bold text-textPrimary">
            ErrandGuy Runner
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications'
          }
          hitSlop={12}
          className="w-10 h-10 items-center justify-center"
          onPress={() => router.push('/(runner)/notifications' as any)}
        >
          <Bell size={22} color="#475569" strokeWidth={1.8} />
          {unreadCount > 0 && (
            <View
              className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-danger items-center justify-center"
              style={{ borderWidth: 1.5, borderColor: '#FFFFFF' }}
            >
              <Text className="text-[9px] font-montserrat-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* Verification Banner */}
        {verificationStatus !== 'approved' && (
          <VerificationBanner
            status={verificationStatus}
            onAction={() => router.push('/(runner)/settings/documents' as any)}
          />
        )}

        {/* Online Button — the big primary CTA */}
        <View className="px-5 mb-6 my-12">
          <OnlineButton
            isOnline={isOnline}
            loading={togglingOnline}
            disabled={verificationStatus !== 'approved'}
            disabledReason="Your account needs verification before you can go online. Submit your documents for review."
            hint={
              locationGranted === false
                ? 'Location permission is off. Tap Enable so customers can see you on the map.'
                : undefined
            }
            hintAction={
              locationGranted === false
                ? {
                    label: 'Enable',
                    onPress: async () => {
                      const req = await Location.requestForegroundPermissionsAsync();
                      setLocationGranted(req.status === 'granted');
                      if (req.status !== 'granted') {
                        toast.warning(
                          'Permission still off. Open device Settings to allow location for ErrandGuy.',
                        );
                      }
                    },
                  }
                : undefined
            }
            onToggle={handleToggleOnline}
          />
        </View>

        {/* Active errand — the most important thing on the screen when
            the runner has work in flight. Sits above stats so it's the
            first thing seen on every return-to-foreground. */}
        {activeErrand && (
          <View className="px-5 mb-4">
            <ActiveRunnerErrandCard
              errand={activeErrand}
              onPress={() => router.push(`/(runner)/errand/${activeErrand.id}` as any)}
            />
          </View>
        )}

        {/* Snapshot — a single, calm summary card that replaces the
            old icon-heavy 3-tile row. The hierarchy is now:
              • the most actionable number (today's earnings) is the
                hero, large and on-brand;
              • lifetime context (total errands, rating) sits below as
                small secondary stats separated by a divider.
            No icons — the labels carry the meaning, which keeps the
            section quiet so the eye returns to the Online button. */}
        <View className="px-5 mb-4">
          <View
            className="bg-surface rounded-2xl px-5 py-4"
            style={{
              shadowColor: '#0F172A',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.05,
              shadowRadius: 10,
              elevation: 2,
            }}
          >
            <View className="flex-row items-end justify-between">
              <View>
                <Text className="text-[11px] font-montserrat-semi text-textTertiary uppercase tracking-wider">
                  Today’s earnings
                </Text>
                <Text className="text-2xl font-montserrat-bold text-textPrimary mt-0.5">
                  {formatCurrency(earnings.today)}
                </Text>
              </View>
              <Pressable
                onPress={() => router.push('/(runner)/(tabs)/earnings' as any)}
                hitSlop={8}
                className="px-3 py-1.5 rounded-full bg-primary50"
              >
                <Text className="text-[11px] font-montserrat-bold text-primary">View</Text>
              </Pressable>
            </View>

            <View className="h-px bg-divider my-3" />

            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <Text className="text-[10px] font-montserrat-semi text-textTertiary uppercase tracking-wider">
                  Total errands
                </Text>
                <Text className="text-base font-montserrat-bold text-textPrimary mt-0.5">
                  {runnerProfile?.total_errands ?? 0}
                </Text>
              </View>
              <View className="w-px h-8 bg-divider mx-3" />
              <View className="flex-1">
                <Text className="text-[10px] font-montserrat-semi text-textTertiary uppercase tracking-wider">
                  Rating
                </Text>
                <View className="flex-row items-center mt-0.5">
                  <Text className="text-base font-montserrat-bold text-textPrimary">
                    {Number(user?.avg_rating ?? 0).toFixed(1)}
                  </Text>
                  <Star size={12} color="#F59E0B" fill="#F59E0B" style={{ marginLeft: 4 }} />
                </View>
              </View>
              <View className="w-px h-8 bg-divider mx-3" />
              <View className="flex-1">
                <Text className="text-[10px] font-montserrat-semi text-textTertiary uppercase tracking-wider">
                  Acceptance
                </Text>
                <Text className="text-base font-montserrat-bold text-textPrimary mt-0.5">
                  {Math.round(runnerProfile?.acceptance_rate ?? 0)}%
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Negotiate Offers (Online only) */}
        {isOnline && negotiateOffers.length > 0 && (
          <View className="px-5 mb-4">
            <View className="flex-row items-center gap-2 mb-2">
              <Handshake size={16} color="#2563EB" />
              <Text className="text-xs font-montserrat-bold text-textTertiary uppercase tracking-wider">
                Negotiate Offers ({negotiateOffers.length})
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

        {/* Recent Errands */}
        <View className="px-5">
          <Text className="text-xs font-montserrat-bold text-textTertiary uppercase tracking-wider mb-2 ml-0.5">
            Recent Errands
          </Text>
          {recentErrands.length === 0 ? (
            <Card className="items-center py-8">
              <Text className="text-sm font-montserrat text-textTertiary">
                {isOnline
                  ? 'No recent errands yet.'
                  : 'Go online to start earning.'}
              </Text>
            </Card>
          ) : (            <>
              {recentErrands.map((errand) => (
                <Card key={errand.id} className="mb-2 p-3">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-sm font-montserrat-bold text-textPrimary">
                        {errand.errand_type?.name ?? 'Errand'}
                      </Text>
                      <Text className="text-xs font-montserrat text-textTertiary">
                        •
                      </Text>
                      <Text className="text-sm font-montserrat-bold text-primary">
                        {formatCurrency(errand.runner_payout ?? errand.total_amount)}
                      </Text>
                    </View>
                    <Text className="text-xs font-montserrat text-textTertiary">
                      {errand.distance_km ? `${errand.distance_km} km` : ''}
                    </Text>
                  </View>
                </Card>
              ))}
              <Pressable
                onPress={() => router.push('/(runner)/(tabs)/history' as any)}
                className="items-center py-2"
              >
                <Text className="text-xs font-montserrat-bold text-primary">
                  View All →
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>

      {/* Incoming Request Modal */}
      {incomingRequest && (
        <IncomingRequestModal
          booking={incomingRequest.booking}
          onAccept={handleAcceptErrand}
          onDecline={handleDeclineErrand}
          timeoutSeconds={30}
        />
      )}
    </SafeAreaView>
  );
}
