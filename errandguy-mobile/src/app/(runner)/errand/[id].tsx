import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, ScrollView, TextInput, RefreshControl, Pressable, Linking, KeyboardAvoidingView, Platform, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  MessageCircle,
  Phone,
  MapPin,
  Navigation,
  CheckCircle,
  Circle,
  ShoppingBag,
  ShieldAlert,
} from 'lucide-react-native';
import { Card } from '../../../components/ui/Card';
import { Avatar } from '../../../components/ui/Avatar';
import { Button } from '../../../components/ui/Button';
import { BackButton } from '../../../components/ui/BackButton';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { StatusActionButton, getNextStatus } from '../../../components/runner/StatusActionButton';
import { ErrandDetailsCard } from '../../../components/runner/ErrandDetailsCard';
import { PhotoProofModal } from '../../../components/runner/PhotoProofModal';
import { ReceiptCaptureModal } from '../../../components/runner/ReceiptCaptureModal';
import { CompletionModal } from '../../../components/runner/CompletionModal';
import { RateCustomerModal } from '../../../components/runner/RateCustomerModal';
import { RunnerActiveMap } from '../../../components/runner/RunnerActiveMap';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useAuthStore } from '../../../stores/authStore';
import { useChatStore } from '../../../stores/chatStore';
import { useLocationStore } from '../../../stores/locationStore';
import { useForegroundInterval } from '../../../hooks/useForegroundInterval';
import { useBackGuard, confirmLeaveErrand } from '../../../hooks/useBackGuard';
import { useQuery } from '../../../hooks/useQuery';
import { useEta } from '../../../hooks/useEta';
import { CacheTTL } from '../../../services/cache.service';
import { runnerService } from '../../../services/runner.service';
import type { Booking } from '../../../types';
import { STATUS_LABELS } from '../../../constants/statusLabels';
import { getErrandTypeRule } from '../../../constants/errandTypeRules';
import { formatCurrency } from '../../../utils/formatCurrency';
import type { BookingStatus } from '../../../types';
import { toast } from '../../../stores/toastStore';

const TIMELINE_STEPS: BookingStatus[] = [
  'accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
  'picked_up',
  'in_transit',
  'arrived_at_dropoff',
  'delivered',
  'completed',
];

/** Statuses that mean "runner is heading to / at the pickup location".
 *  `matched` is included because the runner is assigned but hasn't yet
 *  acknowledged via 'accepted' — they are still travelling to pickup
 *  (or about to). Treating matched as dropoff phase would point the
 *  route + navigate button at the wrong location. */
const PICKUP_PHASE_STATUSES = new Set<string>([
  'matched',
  'accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
]);

export default function ActiveErrandScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentErrand, updateErrandStatus } = useRunnerStore();
  const refreshUnread = useChatStore((s) => s.refreshUnread);
  const unreadForBooking = useChatStore(
    (s) => (id ? s.unreadByBooking[id] ?? 0 : 0),
  );

  // Refresh unread chat counts every 30s, paused when backgrounded.
  useForegroundInterval(refreshUnread, 30000);

  // Make sure GPS streaming is running while there's an active errand,
  // even if the runner toggled offline elsewhere. Stops nothing on
  // unmount because the dashboard owns the long-lived subscription.
  const isTracking = useLocationStore((s) => s.isTracking);
  const startTracking = useLocationStore((s) => s.startTracking);
  const currentLocation = useLocationStore((s) => s.currentLocation);
  useEffect(() => {
    if (!isTracking) {
      startTracking()
        .then((ok) => {
          if (!ok) {
            toast.warning(
              'Location permission is off. Customers can\u2019t see your live position.',
            );
          }
        })
        .catch(() => {});
    }
  }, [isTracking, startTracking]);

  const [loading, setLoading] = useState(false);
  const [showPhotoProof, setShowPhotoProof] = useState<'pickup' | 'delivery' | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const [showRate, setShowRate] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinVerified, setPinVerified] = useState(false);
  const [deliveryPhotoUrl, setDeliveryPhotoUrl] = useState<string | null>(null);

  // Always run the fetch in parallel \u2014 even when storeMatchesUrl is
  // true. The store-backed copy can be stale (e.g. customer cancelled,
  // status was advanced from the admin panel, another session moved
  // the booking forward), and useQuery is stale-while-revalidate so a
  // cached value is returned synchronously while the network refresh
  // happens in the background. The cache is keyed by booking id so a
  // returning runner sees their last known state instantly.
  const storeMatchesUrl = currentErrand?.id === id;
  const fetchedQ = useQuery<Booking | null>(
    ['runner', 'errand', 'byId', id ?? 'none'],
    async () => {
      if (!id) return null;
      const r = await runnerService.getErrand(id);
      return (r.data?.data ?? null) as Booking | null;
    },
    { staleTime: 15_000, ttl: CacheTTL.SHORT, enabled: !!id },
  );

  // Prefer the *freshest* of the two sources rather than always
  // store-first. The store-held copy can be older than what we just
  // fetched (status changed elsewhere, payload trimmed at accept-time
  // missing fields like statusLogs / errand_type, etc.).
  const booking: Booking | null = (() => {
    if (storeMatchesUrl && fetchedQ.data) {
      // Both available \u2014 the fetched copy has full relations and the
      // latest status, so prefer it. The store copy is kept in sync by
      // the effect below.
      return fetchedQ.data;
    }
    if (storeMatchesUrl) return currentErrand;
    return fetchedQ.data ?? null;
  })();

  // Self-claim the booking into the runner store whenever this user is
  // the assigned runner and the errand is still active. Covers both
  // paths into this screen:
  //  1) Accept via IncomingRequestModal (acceptErrand already populated
  //     the store; this effect is a no-op).
  //  2) Cold-start / notification deep-link (store is empty; this
  //     effect promotes the fetched booking so other screens \u2014 home
  //     dashboard, location store, chat \u2014 see it).
  // Also handles the inverse: if the booking is no longer assigned to
  // us (admin reassigned, runner removed), drop it from the store.
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  useEffect(() => {
    const src = fetchedQ.data ?? (storeMatchesUrl ? currentErrand : null);
    if (!src || !myUserId) return;
    const isMine = src.runner_id === myUserId;
    const isActive = !['completed', 'cancelled', 'no_runner'].includes(src.status);
    if (isMine && isActive) {
      // Only write when the cached store copy is missing or stale to
      // avoid a setState loop.
      const existing = useRunnerStore.getState().currentErrand;
      if (!existing || existing.id !== src.id || existing.status !== src.status) {
        useRunnerStore.setState({ currentErrand: src });
      }
    } else if (storeMatchesUrl) {
      // It's still the same id but no longer mine / no longer active.
      // Clear the store so the runner home doesn't keep promoting a
      // stale active errand.
      useRunnerStore.setState({ currentErrand: null });
    }
  }, [fetchedQ.data, storeMatchesUrl, currentErrand, myUserId]);

  // Read-only ONLY if this booking is genuinely not the user's, or it's
  // already terminal. Don't depend on the store \u2014 that introduces a
  // race window where the action button briefly disappears between
  // mount and the self-claim effect firing.
  const isReadOnly = (() => {
    if (!booking) return true;
    if (['completed', 'cancelled', 'no_runner'].includes(booking.status)) return true;
    if (booking.runner_id == null) return true; // unassigned (shouldn't happen on this screen)
    if (myUserId && booking.runner_id !== myUserId) return true;
    return false;
  })();

  // Light status-sync poll. The errand screen is the runner's primary
  // workspace during a job; if the customer cancels, the admin force-
  // completes, or another mobile session advances status, we want the
  // CTA to reflect that within ~15s without burning battery.
  //
  // We fetch directly (not via fetchedQ.refresh) so we can also push the
  // result into the runner store \u2014 otherwise, when storeMatchesUrl=true
  // the screen renders from `currentErrand` and ignores fetchedQ.data
  // entirely. The fetch is cache-backed via runnerService.getErrand
  // (cacheTtlMs: 4_000) so back-to-back triggers within the cache
  // window collapse to one network call.
  const _bookingForPollGuard = booking;
  const _pollEnabled =
    !!id &&
    !!_bookingForPollGuard &&
    !['completed', 'cancelled', 'no_runner'].includes(_bookingForPollGuard.status);
  useForegroundInterval(
    () => {
      if (!id) return;
      runnerService
        .getErrand(id)
        .then((r) => {
          const fresh = (r?.data?.data ?? null) as Booking | null;
          if (!fresh) return;
          // Mirror into the store when this is the runner's active job
          // so the home screen + other consumers see the new status.
          const store = useRunnerStore.getState();
          if (store.currentErrand?.id === fresh.id && fresh.status !== store.currentErrand.status) {
            if (fresh.status === 'completed' || fresh.status === 'cancelled') {
              store.updateErrandStatus(fresh.status);
            } else {
              useRunnerStore.setState({ currentErrand: fresh });
            }
          }
        })
        .catch(() => {});
    },
    15_000,
    _pollEnabled,
    false,
  );

  // ── Hooks below MUST stay above the early-return so that the hook
  // call order is stable across the null → resolved booking transition.
  // Optional chaining keeps them safe when `booking` is still loading.
  const isTransportation = !!booking?.is_transportation;
  const errandSlug = booking?.errand_type?.slug;
  const errandRule = getErrandTypeRule(errandSlug);
  const isShoppingErrand = errandRule.requiresShoppingBudget;
  const isSingleLocation = errandRule.singleLocation;
  const isErrandActive = !!booking && !['completed', 'cancelled', 'no_runner'].includes(booking.status);
  // Android hardware-back guard: require two presses while errand is active
  // AND the runner is the assigned mutator (read-only deep link can leave freely).
  useBackGuard(isErrandActive && !isReadOnly);
  const timelineSteps = errandRule.statusFlow as unknown as BookingStatus[];
  const currentStatusIdx = booking ? timelineSteps.indexOf(booking.status) : -1;

  // Live ETA from the runner's device GPS to the active destination
  // (pickup or dropoff depending on phase). Drives the "X min away"
  // overlay on the runner's mini map and gives the runner a constant
  // sense of progress without flipping to Google Maps.
  //
  // Single-location errands (queue, bills, document) only have a
  // pickup pin — there is no dropoff leg — so we always route to the
  // pickup regardless of status. Otherwise, fall back to the dropoff
  // only after the package leaves pickup.
  const inPickupPhase =
    isSingleLocation || (booking ? PICKUP_PHASE_STATUSES.has(booking.status) : true);
  const etaTargetLat = inPickupPhase ? booking?.pickup_lat : booking?.dropoff_lat;
  const etaTargetLng = inPickupPhase ? booking?.pickup_lng : booking?.dropoff_lng;
  const runnerEta = useEta(
    currentLocation
      ? { lat: currentLocation.lat, lng: currentLocation.lng }
      : null,
    etaTargetLat != null && etaTargetLng != null
      ? { lat: Number(etaTargetLat), lng: Number(etaTargetLng) }
      : null,
  );

  const customerPhone =
    booking?.dropoff_contact_phone ??
    booking?.pickup_contact_phone ??
    booking?.customer?.phone ??
    null;
  const customerName =
    booking?.dropoff_contact_name ??
    booking?.pickup_contact_name ??
    booking?.customer?.full_name ??
    'Customer';

  const handleCallCustomer = useCallback(() => {
    if (!customerPhone) {
      toast.error('Customer phone is not available');
      return;
    }
    Linking.openURL(`tel:${customerPhone}`).catch(() =>
      toast.error('Could not start call'),
    );
  }, [customerPhone]);

  // Runner-side SOS — tap once to open confirm, again to broadcast.
  // Idempotent on the backend, so a double-tap won't stack alerts.
  const [showSOSConfirm, setShowSOSConfirm] = useState(false);
  const [sosLoading, setSosLoading] = useState(false);
  const [sosActive, setSosActive] = useState<boolean>(false);
  // Sync the SOS toggle from the (possibly async) booking payload.
  useEffect(() => {
    if (booking?.sos_triggered) setSosActive(true);
  }, [booking?.sos_triggered]);

  const handleConfirmSOS = useCallback(async () => {
    if (sosLoading || !booking) return;
    setSosLoading(true);
    try {
      await runnerService.triggerSOS(booking.id);
      setSosActive(true);
      setShowSOSConfirm(false);
      toast.success('Emergency contacts notified');
    } catch {
      toast.error('Could not trigger SOS. Try again.');
    } finally {
      setSosLoading(false);
    }
  }, [booking, sosLoading]);

  if (!booking) {
    if (fetchedQ.loading) {
      return (
        <SafeAreaView className="flex-1 bg-background items-center justify-center" edges={['top']}>
          <Text className="text-sm font-montserrat text-textSecondary">Loading errand…</Text>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center px-8" edges={['top']}>
        <Text className="text-base font-montserrat-bold text-textPrimary mb-1">Errand unavailable</Text>
        <Text className="text-xs font-montserrat text-textSecondary text-center mb-4">
          This errand is no longer accessible. It may have been reassigned or removed.
        </Text>
        <Button title="Go Back" variant="outline" onPress={() => router.canGoBack() ? router.back() : router.replace('/(runner)/(tabs)')} />
      </SafeAreaView>
    );
  }

  const handleStatusUpdate = async () => {
    const nextStatus = getNextStatus(booking.status, errandSlug);
    if (!nextStatus) return;

    // Shopping errands: capture receipt + actual cost when transitioning into picked_up.
    if (booking.status === 'arrived_at_pickup' && isShoppingErrand) {
      setShowReceipt(true);
      return;
    }

    // Photo proof at pickup (non-shopping, non-transport item errands)
    if (
      booking.status === 'arrived_at_pickup' &&
      !isTransportation &&
      !isShoppingErrand &&
      !isSingleLocation
    ) {
      setShowPhotoProof('pickup');
      return;
    }

    // Single-location errands jump from picked_up straight to completed —
    // no parcel handover, no signature. Show the completion modal so the
    // runner can leave a note + (optional) photo of the completed task.
    if (isSingleLocation && booking.status === 'picked_up') {
      setShowCompletion(true);
      return;
    }

    // Completion modal at delivery/arrived_at_dropoff (multi-location errands)
    if (booking.status === 'arrived_at_dropoff') {
      setShowPhotoProof('delivery');
      return;
    }

    if (booking.status === 'delivered') {
      setShowCompletion(true);
      return;
    }

    await advanceStatus(nextStatus);
  };

  const advanceStatus = async (status: string) => {
    setLoading(true);
    try {
      await runnerService.updateErrandStatus(booking.id, status);
      updateErrandStatus(status as BookingStatus);

      if (status === 'completed') {
        setShowRate(true);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to update status');
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoConfirm = async (uri: string) => {
    setShowPhotoProof(null);
    if (showPhotoProof === 'delivery') {
      setDeliveryPhotoUrl(uri);
      setShowCompletion(true);
      return;
    }
    const nextStatus = getNextStatus(booking.status, errandSlug);
    if (nextStatus) {
      await advanceStatus(nextStatus);
    }
  };

  const handleCompletionConfirm = async (_signatureUri: string) => {
    setShowCompletion(false);
    await advanceStatus('completed');
  };

  const handleVerifyPin = async () => {
    if (pinInput.length !== 4) return;
    setLoading(true);
    try {
      // Hit the dedicated PIN endpoint — NOT the generic status updater.
      // The server validates the 4-digit code against booking.ride_pin,
      // tracks attempts, and flips ride_pin_verified on success.
      await runnerService.verifyRidePin(booking.id, pinInput);
      setPinVerified(true);
      toast.success('PIN verified — ride may begin');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Incorrect PIN. Please try again.');
      setPinInput('');
    } finally {
      setLoading(false);
    }
  };

  const handleRateSubmit = async (rating: number, comment: string) => {
    setShowRate(false);
    try {
      await runnerService.submitCustomerReview(booking.id, rating, comment);
      toast.success('Thanks for your feedback');
    } catch (err: any) {
      // Don't block the runner from leaving the screen on failure — their
      // shift continues. Most common 422 here is "already reviewed".
      const msg = err?.response?.data?.message;
      if (msg && err?.response?.status !== 422) {
        toast.error(msg);
      }
    } finally {
      router.replace('/(runner)/(tabs)' as any);
    }
  };

  const handleRateSkip = () => {
    setShowRate(false);
    router.replace('/(runner)/(tabs)' as any);
  };

  // Sheet height \u2014 ~55% of the window. Using a flex-based split (map
  // grows, sheet stays a fixed slice) instead of absolute positioning
  // because the previous absolute+maxHeight layout collapsed the inner
  // ScrollView to zero and pushed the sticky action button off-screen.
  const SHEET_HEIGHT = Math.round(Dimensions.get('window').height * 0.55);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={[]}>
      <View style={{ flex: 1 }}>
        {/* ── Map area (top half, fills remaining space) ────────── */}
        <View style={{ flex: 1, position: 'relative' }}>
          <RunnerActiveMap
            variant="fill"
            pickupLat={booking.pickup_lat}
            pickupLng={booking.pickup_lng}
            dropoffLat={booking.dropoff_lat}
            dropoffLng={booking.dropoff_lng}
            inPickupPhase={inPickupPhase}
            singleLocation={isSingleLocation}
            etaMinutes={runnerEta.minutes}
          />

          {/* Floating top bar */}
          <SafeAreaView
            edges={['top']}
            pointerEvents="box-none"
            style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
          >
            <View
              className="flex-row items-center justify-between px-4 py-2"
              pointerEvents="box-none"
            >
              <View className="w-11 h-11 rounded-full bg-white items-center justify-center shadow-md">
                <BackButton
                  fallbackHref="/(runner)/(tabs)"
                  accessibilityHint={isErrandActive ? 'Confirms before leaving the active errand' : undefined}
                  onPress={() => {
                    const goBack = () =>
                      router.canGoBack() ? router.back() : router.replace('/(runner)/(tabs)');
                    if (isErrandActive) confirmLeaveErrand(goBack);
                    else goBack();
                  }}
                />
              </View>
              <View className="bg-white px-4 py-2 rounded-full shadow-md">
                <Text className="text-sm font-montserrat-bold text-textPrimary">
                  {isTransportation ? 'Passenger Ride' : 'Active Errand'}
                </Text>
              </View>
              <Pressable
                onPress={() => router.push(`/(runner)/chat/${booking.id}` as any)}
                className="w-11 h-11 rounded-full bg-white items-center justify-center shadow-md"
                accessibilityRole="button"
                accessibilityLabel="Open chat with customer"
              >
                <MessageCircle size={20} color="#0F172A" />
                {unreadForBooking > 0 && (
                  <View className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 bg-danger rounded-full items-center justify-center border-[1.5px] border-white">
                    <Text className="text-[9px] text-white font-montserrat-bold leading-[12px]">
                      {unreadForBooking > 9 ? '9+' : String(unreadForBooking)}
                    </Text>
                  </View>
                )}
              </Pressable>
            </View>
          </SafeAreaView>

          {/* No external Navigate FAB — the in-app route line + ETA on
              the map and the in-system Status Action button below ARE
              the navigation. Tapping out to Google/Apple Maps would
              hand the runner off to a third-party app that can’t
              update booking status, location, or notify the customer. */}
        </View>

        {/* ── Bottom sheet (fixed slice with proper flex column) ── */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <View
            className="bg-white rounded-t-3xl"
            style={{
              height: SHEET_HEIGHT,
              shadowColor: '#000',
              shadowOpacity: 0.1,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: -2 },
              elevation: 12,
            }}
          >
            {/* Drag handle */}
            <View className="items-center pt-2 pb-1">
              <View className="w-10 h-1 rounded-full bg-gray-300" />
            </View>

            {/* Header line \u2014 always visible */}
            <View className="px-5 pb-2">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 min-w-0">
                  <Text className="text-[10px] font-montserrat-bold text-textTertiary uppercase tracking-wider">
                    {inPickupPhase ? 'Heading to' : 'Delivering to'}
                  </Text>
                  <Text className="text-sm font-montserrat-bold text-textPrimary mt-0.5" numberOfLines={1}>
                    {inPickupPhase
                      ? booking.pickup_address ?? errandRule.pickupLabel
                      : booking.dropoff_address ?? errandRule.dropoffLabel}
                  </Text>
                </View>
                {runnerEta.minutes != null && (
                  <View className="ml-3 bg-primaryLight px-3 py-1.5 rounded-full">
                    <Text className="text-xs font-montserrat-bold text-primary">
                      {Math.max(1, Math.round(runnerEta.minutes))} min
                    </Text>
                  </View>
                )}
              </View>
              <Text className="text-[11px] font-montserrat text-textSecondary mt-1">
                Status: {STATUS_LABELS[booking.status] ?? booking.status}
              </Text>
            </View>

            {/* Scrollable details \u2014 explicit flex:1 so it actually grows
                inside the fixed-height sheet and the sticky button below
                stays visible. */}
            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Customer Info */}
              <Card className="p-4 mb-3">
                <View className="flex-row items-center gap-3 mb-3">
                  <Avatar name={customerName} size="md" />
                  <View className="flex-1">
                    <Text className="text-sm font-montserrat-bold text-textPrimary">
                      {customerName}
                    </Text>
                    {customerPhone && (
                      <Text className="text-xs font-montserrat text-textSecondary mt-0.5">
                        {customerPhone}
                      </Text>
                    )}
                  </View>
                </View>
                <View className="flex-row gap-3">
                  <Pressable
                    className={`flex-1 flex-row items-center justify-center gap-2 rounded-xl py-2 ${
                      customerPhone ? 'bg-primaryLight' : 'bg-gray-100'
                    }`}
                    onPress={handleCallCustomer}
                    disabled={!customerPhone}
                  >
                    <Phone size={16} color={customerPhone ? '#2563EB' : '#94A3B8'} />
                    <Text
                      className={`text-xs font-montserrat-bold ${
                        customerPhone ? 'text-primary' : 'text-textTertiary'
                      }`}
                    >
                      Call
                    </Text>
                  </Pressable>
                  <Pressable
                    className="flex-1 flex-row items-center justify-center gap-2 bg-primaryLight rounded-xl py-2"
                    onPress={() => router.push(`/(runner)/chat/${booking.id}` as any)}
                  >
                    <MessageCircle size={16} color="#2563EB" />
                    <Text className="text-xs font-montserrat-bold text-primary">Chat</Text>
                  </Pressable>
                </View>
                {!isReadOnly && (
                  <Pressable
                    className={`mt-3 flex-row items-center justify-center gap-2 rounded-xl py-2.5 border ${
                      sosActive ? 'bg-danger border-danger' : 'bg-white border-danger'
                    }`}
                    onPress={() => !sosActive && setShowSOSConfirm(true)}
                    disabled={sosActive || sosLoading}
                  >
                    <ShieldAlert size={16} color={sosActive ? '#FFFFFF' : '#EF4444'} />
                    <Text
                      className={`text-xs font-montserrat-bold ${
                        sosActive ? 'text-white' : 'text-danger'
                      }`}
                    >
                      {sosActive ? 'SOS Active — help notified' : 'Emergency SOS'}
                    </Text>
                  </Pressable>
                )}
              </Card>

              {/* PIN Verification (Transportation only) */}
              {isTransportation && booking.status === 'arrived_at_pickup' && !pinVerified && (
                <Card className="p-4 mb-3">
                  <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">
                    PIN Verification
                  </Text>
                  <Text className="text-xs font-montserrat text-textSecondary mb-3">
                    Ask the passenger to share their 4-digit ride PIN.
                  </Text>
                  <View className="flex-row items-center gap-3">
                    <TextInput
                      className="flex-1 bg-surface border border-divider rounded-xl px-4 py-3 text-center text-xl font-montserrat-bold text-textPrimary tracking-[12px]"
                      value={pinInput}
                      onChangeText={(t) => setPinInput(t.replace(/\D/g, '').slice(0, 4))}
                      keyboardType="number-pad"
                      maxLength={4}
                      placeholder="• • • •"
                      placeholderTextColor="#94A3B8"
                    />
                    <Button
                      title="Verify"
                      onPress={handleVerifyPin}
                      disabled={pinInput.length !== 4}
                      size="sm"
                    />
                  </View>
                </Card>
              )}
              {pinVerified && isTransportation && (
                <View className="mb-3 flex-row items-center gap-2 bg-green-50 p-3 rounded-xl">
                  <CheckCircle size={16} color="#22C55E" />
                  <Text className="text-xs font-montserrat-bold text-green-700">
                    PIN Verified — Ready to start ride
                  </Text>
                </View>
              )}

              {/* Shopping Budget */}
              {isShoppingErrand && booking.shopping_budget != null && (
                <Card className="p-3 bg-amber-50 border border-amber-200 mb-3">
                  <View className="flex-row items-center gap-2 mb-1">
                    <ShoppingBag size={16} color="#B45309" />
                    <Text className="text-xs font-montserrat-bold text-amber-800">
                      Customer Budget (Max)
                    </Text>
                  </View>
                  <Text className="text-xl font-montserrat-bold text-amber-900">
                    {formatCurrency(booking.shopping_budget)}
                  </Text>
                  <Text className="text-[11px] font-montserrat text-amber-700 mt-1">
                    Do not exceed this amount. Capture the receipt at pickup—the customer pays the actual cost.
                  </Text>
                </Card>
              )}

              {/* Errand Details */}
              <View className="mb-3">
                <ErrandDetailsCard
                  description={booking.description}
                  specialInstructions={booking.special_instructions}
                  itemPhotos={booking.item_photos}
                  estimatedItemValue={booking.estimated_item_value}
                />
              </View>

              {/* Payout */}
              <Card className="p-3 flex-row items-center justify-between mb-3">
                <Text className="text-sm font-montserrat text-textSecondary">Payout</Text>
                <Text className="text-lg font-montserrat-bold text-primary">
                  {formatCurrency(booking.runner_payout ?? booking.total_amount)}
                </Text>
              </Card>

              {/* Status Timeline */}
              <View className="mb-2">
                <Text className="text-xs font-montserrat-bold text-textSecondary mb-3 uppercase tracking-wider">
                  Status Timeline
                </Text>
                {timelineSteps.map((step, idx) => {
                  const isCompleted = idx < currentStatusIdx;
                  const isCurrent = idx === currentStatusIdx;
                  return (
                    <View key={step} className="flex-row items-start gap-3 mb-2">
                      <View className="items-center" style={{ width: 20 }}>
                        {isCompleted ? (
                          <CheckCircle size={18} color="#22C55E" />
                        ) : isCurrent ? (
                          <View className="w-[18px] h-[18px] rounded-full bg-primary items-center justify-center">
                            <View className="w-2 h-2 rounded-full bg-white" />
                          </View>
                        ) : (
                          <Circle size={18} color="#94A3B8" />
                        )}
                        {idx < timelineSteps.length - 1 && (
                          <View
                            className={`w-0.5 h-4 mt-0.5 ${
                              isCompleted ? 'bg-success' : 'bg-divider'
                            }`}
                          />
                        )}
                      </View>
                      <Text
                        className={`text-sm font-montserrat ${
                          isCurrent
                            ? 'text-primary font-montserrat-bold'
                            : isCompleted
                            ? 'text-textPrimary'
                            : 'text-gray-400'
                        }`}
                      >
                        {STATUS_LABELS[step] ?? step}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>

            {/* Sticky action button — always visible at bottom of sheet.
                This is THE in-system action: tapping it calls
                POST /runner/errand/{id}/status which advances the
                booking, fires BookingStatusChanged, broadcasts via
                Supabase Realtime, and is mirrored on the customer
                tracking screen within ~5s. */}
            {!isReadOnly ? (
              <View className="px-5 pt-3 pb-3 border-t border-divider bg-white">
                <Text className="text-[10px] font-montserrat-bold text-textTertiary uppercase tracking-wider mb-1.5 text-center">
                  Tap to advance — customer is notified instantly
                </Text>
                <StatusActionButton
                  status={booking.status}
                  errandSlug={errandSlug}
                  isTransportation={isTransportation}
                  pinVerified={pinVerified}
                  onPress={handleStatusUpdate}
                  loading={loading}
                />
              </View>
            ) : (
              <View className="px-5 pt-3 pb-3 border-t border-divider bg-white items-center">
                <Text className="text-[11px] font-montserrat text-textTertiary uppercase tracking-wider mb-0.5">
                  Read-only view
                </Text>
                <Text className="text-xs font-montserrat text-textSecondary">
                  Status: {STATUS_LABELS[booking.status] ?? booking.status}
                </Text>
              </View>
            )}
          </View>
          <SafeAreaView edges={['bottom']} style={{ backgroundColor: 'white' }} />
        </KeyboardAvoidingView>
      </View>


      {/* Photo Proof Modal */}
      {showPhotoProof && (
        <PhotoProofModal
          type={showPhotoProof}
          onConfirm={handlePhotoConfirm}
          onClose={() => setShowPhotoProof(null)}
        />
      )}

      {/* Receipt Capture (shopping errands) */}
      <ReceiptCaptureModal
        visible={showReceipt}
        budget={Number(booking.shopping_budget ?? 0)}
        submitting={submittingReceipt}
        onSubmit={async ({ actualCost, receiptUri }) => {
          setSubmittingReceipt(true);
          try {
            await runnerService.submitPickedUpWithReceipt(booking.id, {
              actualCost,
              receiptUri,
            });
            updateErrandStatus('picked_up');
            setShowReceipt(false);
          } catch (err: any) {
            toast.error(
              err?.response?.data?.message ?? 'Failed to submit receipt',
            );
          } finally {
            setSubmittingReceipt(false);
          }
        }}
        onClose={() => setShowReceipt(false)}
      />

      {/* Completion Modal */}
      {showCompletion && (
        <CompletionModal
          bookingId={booking.id}
          deliveryPhotoUrl={deliveryPhotoUrl}
          requiresSignature={!isSingleLocation && !isTransportation}
          title={
            isTransportation
              ? 'Complete Ride'
              : isSingleLocation
              ? 'Mark Errand Done'
              : 'Complete Errand'
          }
          subtitle={
            isTransportation
              ? 'Tap confirm once the passenger has safely reached their destination.'
              : isSingleLocation
              ? 'Confirm once the task is finished on-site. The customer will be notified right away.'
              : undefined
          }
          onComplete={handleCompletionConfirm}
          onClose={() => setShowCompletion(false)}
        />
      )}

      {/* Rate Customer Modal */}
      {showRate && (
        <RateCustomerModal
          customerName={booking.dropoff_contact_name ?? 'Customer'}
          onSubmit={handleRateSubmit}
          onSkip={handleRateSkip}
        />
      )}

      {/* Runner SOS confirm */}
      <ConfirmModal
        visible={showSOSConfirm}
        title="Trigger emergency SOS?"
        message="Your trusted contacts will get a live trip link via SMS, and ErrandGuy safety will be alerted immediately. Only use this for real emergencies."
        confirmLabel="Send SOS"
        cancelLabel="Not now"
        destructive
        loading={sosLoading}
        onConfirm={handleConfirmSOS}
        onCancel={() => setShowSOSConfirm(false)}
      />
    </SafeAreaView>
  );
}
