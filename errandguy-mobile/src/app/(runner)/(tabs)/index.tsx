import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, RefreshControl, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Bell, Package, Handshake } from 'lucide-react-native';
import { DollarSign, CheckCircle, Star } from 'lucide-react-native';
import { OnlineToggle } from '../../../components/runner/OnlineToggle';
import { StatCard } from '../../../components/runner/StatCard';
import { NegotiateOfferCard } from '../../../components/runner/NegotiateOfferCard';
import { VerificationBanner } from '../../../components/runner/VerificationBanner';
import { IncomingRequestModal } from '../../../components/runner/IncomingRequestModal';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useLocationStore } from '../../../stores/locationStore';
import { useAuthStore } from '../../../stores/authStore';
import { runnerService } from '../../../services/runner.service';
import { formatCurrency } from '../../../utils/formatCurrency';
import { RunnerHomeSkeleton } from '../../../components/ui/Skeleton';
import { CacheService, CacheTTL, CacheKeys } from '../../../services/cache.service';
import { useIncomingRequest } from '../../../hooks/useIncomingRequest';
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

  // Subscribe to incoming booking requests via Supabase Realtime
  useIncomingRequest(isOnline && user?.id ? user.id : null);

  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [negotiateOffers, setNegotiateOffers] = useState<Booking[]>([]);
  const [recentErrands, setRecentErrands] = useState<Booking[]>([]);
  const hasCacheLoaded = useRef(false);

  const fetchDashboardData = useCallback(async (isRefresh = false) => {
    const userId = user?.id ?? 'anon';

    // Load cached data first to skip skeleton on revisit
    if (!hasCacheLoaded.current && !isRefresh) {
      const [cachedProfile, cachedHistory] = await Promise.all([
        CacheService.get<any>(CacheKeys.runnerProfile(userId)),
        CacheService.get<Booking[]>(`runner:${userId}:history`),
      ]);
      if (cachedProfile) setRunnerProfile(cachedProfile);
      if (cachedHistory) setRecentErrands(cachedHistory);
      if (cachedProfile || cachedHistory) {
        hasCacheLoaded.current = true;
        setInitialLoading(false);
      }
    }

    try {
      const results = await Promise.allSettled([
        runnerService.getRunnerProfile(),
        runnerService.getEarnings('today'),
        runnerService.getErrandHistory({ page: 1, per_page: 5 }),
      ]);

      if (results[0].status === 'fulfilled') {
        const profile = results[0].value.data.data;
        setRunnerProfile(profile);
        CacheService.set(CacheKeys.runnerProfile(userId), profile, CacheTTL.MEDIUM);
      }
      if (results[1].status === 'fulfilled') {
        setEarnings({
          ...earnings,
          today: results[1].value.data.data?.total_earnings ?? 0,
        });
      }
      if (results[2].status === 'fulfilled') {
        const history = results[2].value.data.data ?? [];
        setRecentErrands(history);
        CacheService.set(`runner:${userId}:history`, history, CacheTTL.MEDIUM);
      }

      if (isOnline) {
        try {
          const offersRes = await runnerService.getAvailableErrands();
          setNegotiateOffers(offersRes.data.data ?? []);
        } catch {}
      }
    } catch {
      // silent fail - dashboard data is non-critical
    } finally {
      hasCacheLoaded.current = true;
      setInitialLoading(false);
    }
  }, [isOnline, user?.id]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    if (currentErrand) {
      router.push(`/(runner)/errand/${currentErrand.id}`);
    }
  }, [currentErrand]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDashboardData(true);
    setRefreshing(false);
  }, [fetchDashboardData]);

  const handleToggleOnline = async (value: boolean) => {
    try {
      let coords: { lat: number; lng: number } | undefined;
      if (value) {
        const { currentLocation } = useLocationStore.getState();
        if (currentLocation) {
          coords = { lat: currentLocation.lat, lng: currentLocation.lng };
        } else {
          // Request location before going online
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        }
      }
      await runnerService.toggleOnline(value, coords);
      toggleOnline(value);
      if (value) {
        await startTracking();
      } else {
        stopTracking();
        setNegotiateOffers([]);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to toggle status');
    }
  };

  const handleAcceptErrand = async () => {
    if (!incomingRequest) return;
    try {
      await runnerService.acceptErrand(incomingRequest.booking.id);
      acceptErrand(incomingRequest.booking);
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
      <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
        <View>
          <Text className="text-xs font-montserrat text-textTertiary">
            Dashboard
          </Text>
          <Text className="text-lg font-montserrat-bold text-textPrimary">
            ErrandGuy Runner
          </Text>
        </View>
        <Pressable
          className="w-10 h-10 rounded-full bg-primary50 items-center justify-center"
          onPress={() => router.push('/(runner)/settings/notifications' as any)}
        >
          <Bell size={20} color="#2563EB" strokeWidth={1.8} />
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

        {/* Online Toggle */}
        <View className="px-5 mb-4">
          <OnlineToggle
            isOnline={isOnline}
            onToggle={handleToggleOnline}
            disabled={verificationStatus !== 'approved'}
          />
        </View>

        {/* Today's Stats */}
        <View className="px-5 mb-4">
          <Text className="text-xs font-montserrat-bold text-textTertiary uppercase tracking-wider mb-2 ml-0.5">
            Today's Stats
          </Text>
          <View className="flex-row gap-3">
            <StatCard
              icon={DollarSign}
              value={formatCurrency(earnings.today)}
              label="Earnings"
              color="#22C55E"
            />
            <StatCard
              icon={CheckCircle}
              value={runnerProfile?.total_errands ?? 0}
              label="Errands"
              color="#2563EB"
            />
            <StatCard
              icon={Star}
              value={Number(user?.avg_rating ?? 0).toFixed(1)}
              label="Rating"
              color="#F59E0B"
            />
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
              <View className="w-14 h-14 rounded-2xl bg-primary50 items-center justify-center mb-2">
                <Package size={22} color="#2563EB" />
              </View>
              <Text className="text-sm font-montserrat text-textTertiary mt-1">
                {isOnline
                  ? 'No recent errands yet.'
                  : 'Go online to start earning!'}
              </Text>
            </Card>
          ) : (
            <>
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
