import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, FlatList, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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
import type { Booking } from '../../../types';

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

  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [negotiateOffers, setNegotiateOffers] = useState<Booking[]>([]);
  const [recentErrands, setRecentErrands] = useState<Booking[]>([]);

  const fetchDashboardData = useCallback(async () => {
    try {
      const [profileRes, earningsRes, historyRes] = await Promise.all([
        runnerService.getRunnerProfile(),
        runnerService.getEarnings('today'),
        runnerService.getErrandHistory({ page: 1, per_page: 5 }),
      ]);
      setRunnerProfile(profileRes.data.data);
      setEarnings({
        ...earnings,
        today: earningsRes.data.data?.total_earnings ?? 0,
      });
      setRecentErrands(historyRes.data.data ?? []);

      if (isOnline) {
        const offersRes = await runnerService.getAvailableErrands();
        setNegotiateOffers(offersRes.data.data ?? []);
      }
    } catch {
      // silent fail - dashboard data is non-critical
    } finally {
      setInitialLoading(false);
    }
  }, [isOnline]);

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
    await fetchDashboardData();
    setRefreshing(false);
  }, [fetchDashboardData]);

  const handleToggleOnline = async (value: boolean) => {
    try {
      await runnerService.toggleOnline(value);
      toggleOnline(value);
      if (value) {
        await startTracking();
      } else {
        stopTracking();
        setNegotiateOffers([]);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to toggle status');
    }
  };

  const handleAcceptErrand = async () => {
    if (!incomingRequest) return;
    try {
      await runnerService.acceptErrand(incomingRequest.booking.id);
      acceptErrand(incomingRequest.booking);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to accept errand');
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
      <View className="flex-row items-center justify-between px-5 py-4">
        <Text className="text-lg font-montserrat-bold text-textPrimary">
          ErrandGuy Runner
        </Text>
        <Pressable onPress={() => router.push('/(runner)/settings/notifications' as any)}>
          <Bell size={24} color="#0F172A" />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingBottom: 100 }}
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
          <Text className="text-sm font-montserrat-bold text-textSecondary mb-2">
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
              value={user?.avg_rating?.toFixed(1) ?? '0.0'}
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
              <Text className="text-sm font-montserrat-bold text-textSecondary">
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
          <Text className="text-sm font-montserrat-bold text-textSecondary mb-2">
            Recent Errands
          </Text>
          {recentErrands.length === 0 ? (
            <Card className="items-center py-8">
              <Package size={40} color="#94A3B8" />
              <Text className="text-sm font-montserrat text-textSecondary mt-2">
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
                      <Text className="text-xs font-montserrat text-textSecondary">
                        •
                      </Text>
                      <Text className="text-sm font-montserrat-bold text-primary">
                        {formatCurrency(errand.runner_payout ?? errand.total_amount)}
                      </Text>
                    </View>
                    <Text className="text-xs font-montserrat text-textSecondary">
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
