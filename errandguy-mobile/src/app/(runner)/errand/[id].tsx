import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, ScrollView, TextInput, RefreshControl, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
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
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { StatusActionButton, getNextStatus } from '../../../components/runner/StatusActionButton';
import { ErrandDetailsCard } from '../../../components/runner/ErrandDetailsCard';
import { NavigateButton } from '../../../components/runner/NavigateButton';
import { PhotoProofModal } from '../../../components/runner/PhotoProofModal';
import { ReceiptCaptureModal } from '../../../components/runner/ReceiptCaptureModal';
import { CompletionModal } from '../../../components/runner/CompletionModal';
import { RateCustomerModal } from '../../../components/runner/RateCustomerModal';
import { RunnerActiveMap } from '../../../components/runner/RunnerActiveMap';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useChatStore } from '../../../stores/chatStore';
import { useLocationStore } from '../../../stores/locationStore';
import { runnerService } from '../../../services/runner.service';
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

/** Statuses that mean "runner is heading to / at the pickup location". */
const PICKUP_PHASE_STATUSES = new Set<string>([
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

  useEffect(() => {
    refreshUnread();
    const t = setInterval(refreshUnread, 15000);
    return () => clearInterval(t);
  }, [refreshUnread]);

  // Make sure GPS streaming is running while there's an active errand,
  // even if the runner toggled offline elsewhere. Stops nothing on
  // unmount because the dashboard owns the long-lived subscription.
  const isTracking = useLocationStore((s) => s.isTracking);
  const startTracking = useLocationStore((s) => s.startTracking);
  useEffect(() => {
    if (!isTracking) {
      startTracking().catch(() => {});
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

  const booking = currentErrand;

  if (!booking) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center" edges={['top']}>
        <Text className="text-sm font-montserrat text-textSecondary">No active errand</Text>
        <Button title="Go Back" variant="outline" onPress={() => router.canGoBack() ? router.back() : router.replace('/(runner)/(tabs)')} />
      </SafeAreaView>
    );
  }

  const isTransportation = booking.is_transportation;
  const errandSlug = booking.errand_type?.slug;
  const errandRule = getErrandTypeRule(errandSlug);
  const isShoppingErrand = errandRule.requiresShoppingBudget;
  const isSingleLocation = errandRule.singleLocation;
  // Use the per-type flow so single-location errands (queue / bills /
  // document) don't render dropoff stages they will never reach.
  const timelineSteps = errandRule.statusFlow as unknown as BookingStatus[];
  const currentStatusIdx = timelineSteps.indexOf(booking.status);

  /** Phone we can use for one-tap calling the customer.
   *  Prefer the dropoff/pickup contact (whoever physically receives the
   *  errand), fall back to the customer's account phone for single-location
   *  errands or when no explicit contact was provided. */
  const customerPhone =
    booking.dropoff_contact_phone ??
    booking.pickup_contact_phone ??
    booking.customer?.phone ??
    null;
  const customerName =
    booking.dropoff_contact_name ??
    booking.pickup_contact_name ??
    booking.customer?.full_name ??
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
  const [sosActive, setSosActive] = useState<boolean>(
    Boolean(booking.sos_triggered),
  );
  const handleConfirmSOS = useCallback(async () => {
    if (sosLoading) return;
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
  }, [booking.id, sosLoading]);

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
    try {
      await runnerService.updateErrandStatus(booking.id, 'verify_pin');
      setPinVerified(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Please try again');
      setPinInput('');
    }
  };

  const handleRateSubmit = async (rating: number, comment: string) => {
    setShowRate(false);
    // Rating submission would be handled via review service
    router.replace('/(runner)/(tabs)' as any);
  };

  const handleRateSkip = () => {
    setShowRate(false);
    router.replace('/(runner)/(tabs)' as any);
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4">
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(runner)/(tabs)')}
          className="w-9 h-9 rounded-xl bg-surface items-center justify-center"
          style={{ shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}
        >
          <ArrowLeft size={20} color="#0F172A" />
        </Pressable>
        <Text className="text-lg font-montserrat-bold text-textPrimary">
          {isTransportation ? 'Passenger Ride' : 'Active Errand'}
        </Text>
        <Pressable onPress={() => router.push(`/(runner)/chat/${booking.id}` as any)}>
          <MessageCircle size={24} color="#0F172A" />
        </Pressable>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Live Map — runner location, pickup/dropoff markers, route line
            to whichever destination is active for the current phase. */}
        <RunnerActiveMap
          pickupLat={booking.pickup_lat}
          pickupLng={booking.pickup_lng}
          dropoffLat={booking.dropoff_lat}
          dropoffLng={booking.dropoff_lng}
          inPickupPhase={PICKUP_PHASE_STATUSES.has(booking.status)}
          singleLocation={isSingleLocation}
        />

        {/* Navigate Button — always available so single-location errands
            (queue/bills/document) still get one-tap directions to the
            single destination. Toggles between pickup and dropoff based
            on whether the runner is still in the pickup phase. */}
        {(() => {
          const inPickupPhase = PICKUP_PHASE_STATUSES.has(booking.status);
          const targetLat = inPickupPhase ? booking.pickup_lat : booking.dropoff_lat;
          const targetLng = inPickupPhase ? booking.pickup_lng : booking.dropoff_lng;
          if (!targetLat || !targetLng) return null;
          return (
            <View className="px-5 mb-4">
              <NavigateButton
                lat={targetLat}
                lng={targetLng}
                label={inPickupPhase ? errandRule.pickupLabel : errandRule.dropoffLabel}
              />
            </View>
          );
        })()}

        {/* Errand Details */}
        <View className="px-5">
          <ErrandDetailsCard
            description={booking.description}
            specialInstructions={booking.special_instructions}
            itemPhotos={booking.item_photos}
            estimatedItemValue={booking.estimated_item_value}
          />
        </View>

        {/* Payout */}
        <View className="px-5 mb-4">
          <Card className="p-3 flex-row items-center justify-between">
            <Text className="text-sm font-montserrat text-textSecondary">Payout</Text>
            <Text className="text-lg font-montserrat-bold text-primary">
              {formatCurrency(booking.runner_payout ?? booking.total_amount)}
            </Text>
          </Card>
        </View>

        {/* Shopping Budget — pre-authorized cap the runner must respect.
            Shown prominently so the runner knows the spend ceiling before
            buying anything. Customer reconciles after picked_up. */}
        {isShoppingErrand && booking.shopping_budget != null && (
          <View className="px-5 mb-4">
            <Card className="p-3 bg-amber-50 border border-amber-200">
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
          </View>
        )}

        {/* PIN Verification (Transportation only) */}
        {isTransportation && booking.status === 'arrived_at_pickup' && !pinVerified && (
          <View className="px-5 mb-4">
            <Card className="p-4">
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
          </View>
        )}

        {pinVerified && isTransportation && (
          <View className="px-5 mb-2">
            <View className="flex-row items-center gap-2 bg-green-50 p-3 rounded-xl">
              <CheckCircle size={16} color="#22C55E" />
              <Text className="text-xs font-montserrat-bold text-green-700">
                PIN Verified — Ready to start ride
              </Text>
            </View>
          </View>
        )}

        {/* Status Timeline — honors the per-type flow so we don't show
            "Drop-off" stages on a queue or bills-payment job. */}
        <View className="px-5 mb-4">
          <Text className="text-sm font-montserrat-bold text-textSecondary mb-3">
            Status Timeline
          </Text>
          {timelineSteps.map((step, idx) => {
            const isCompleted = idx < currentStatusIdx;
            const isCurrent = idx === currentStatusIdx;
            const isPending = idx > currentStatusIdx;

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

        {/* Customer Info */}
        <View className="px-5 mb-4">
          <Card className="p-4">
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
                <View>
                  <MessageCircle size={16} color="#2563EB" />
                  {unreadForBooking > 0 && (
                    <View className="absolute -top-1 -right-2 min-w-[14px] h-[14px] px-1 bg-danger rounded-full items-center justify-center border-[1.5px] border-white">
                      <Text className="text-[8px] text-white font-montserrat-bold leading-[10px]">
                        {unreadForBooking > 9 ? '9+' : String(unreadForBooking)}
                      </Text>
                    </View>
                  )}
                </View>
                <Text className="text-xs font-montserrat-bold text-primary">Chat</Text>
              </Pressable>
            </View>

            {/* Runner safety — emergency button. Stays subtle (red outline)
                so it doesn't compete with the primary status CTA. */}
            <Pressable
              className={`mt-3 flex-row items-center justify-center gap-2 rounded-xl py-2.5 border ${
                sosActive
                  ? 'bg-danger border-danger'
                  : 'bg-white border-danger'
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
          </Card>
        </View>
      </ScrollView>

      {/* Bottom Action Button */}
      <View className="absolute bottom-0 left-0 right-0 bg-background border-t border-divider px-5 py-4 pb-8">
        <StatusActionButton
          status={booking.status}
          errandSlug={errandSlug}
          isTransportation={isTransportation}
          pinVerified={pinVerified}
          onPress={handleStatusUpdate}
          loading={loading}
        />
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
