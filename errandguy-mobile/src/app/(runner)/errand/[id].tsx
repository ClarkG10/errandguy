import React, { useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TextInput, Alert, RefreshControl, Pressable } from 'react-native';
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
} from 'lucide-react-native';
import { Card } from '../../../components/ui/Card';
import { Avatar } from '../../../components/ui/Avatar';
import { Button } from '../../../components/ui/Button';
import { StatusActionButton, getNextStatus } from '../../../components/runner/StatusActionButton';
import { ErrandDetailsCard } from '../../../components/runner/ErrandDetailsCard';
import { NavigateButton } from '../../../components/runner/NavigateButton';
import { PhotoProofModal } from '../../../components/runner/PhotoProofModal';
import { CompletionModal } from '../../../components/runner/CompletionModal';
import { RateCustomerModal } from '../../../components/runner/RateCustomerModal';
import { useRunnerStore } from '../../../stores/runnerStore';
import { runnerService } from '../../../services/runner.service';
import { STATUS_LABELS } from '../../../constants/statusLabels';
import { formatCurrency } from '../../../utils/formatCurrency';
import type { BookingStatus } from '../../../types';

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

export default function ActiveErrandScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentErrand, updateErrandStatus } = useRunnerStore();

  const [loading, setLoading] = useState(false);
  const [showPhotoProof, setShowPhotoProof] = useState<'pickup' | 'delivery' | null>(null);
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
        <Button title="Go Back" variant="outline" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  const isTransportation = booking.is_transportation;
  const currentStatusIdx = TIMELINE_STEPS.indexOf(booking.status);

  const handleStatusUpdate = async () => {
    const nextStatus = getNextStatus(booking.status);
    if (!nextStatus) return;

    // Photo proof at pickup
    if (booking.status === 'arrived_at_pickup' && !isTransportation) {
      setShowPhotoProof('pickup');
      return;
    }

    // Completion modal at delivery/arrived_at_dropoff
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
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to update status');
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
    const nextStatus = getNextStatus(booking.status);
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
      Alert.alert('Invalid PIN', err?.response?.data?.message ?? 'Please try again');
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
        <Pressable onPress={() => router.back()}>
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-lg font-montserrat-bold text-textPrimary">
          {isTransportation ? 'Passenger Ride' : 'Active Errand'}
        </Text>
        <Pressable onPress={() => router.push(`/(runner)/chat/${booking.id}` as any)}>
          <MessageCircle size={24} color="#0F172A" />
        </Pressable>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Map Placeholder */}
        <View className="mx-5 h-48 bg-gray-100 rounded-xl items-center justify-center mb-4">
          <Navigation size={32} color="#94A3B8" />
          <Text className="text-sm font-montserrat text-textSecondary mt-2">Map View</Text>
        </View>

        {/* Navigate Button */}
        {booking.dropoff_lat && booking.dropoff_lng && (
          <View className="px-5 mb-4">
            <NavigateButton
              lat={booking.status.includes('pickup') ? booking.pickup_lat : booking.dropoff_lat}
              lng={booking.status.includes('pickup') ? booking.pickup_lng : booking.dropoff_lng}
              label={booking.status.includes('pickup') ? 'Pickup' : 'Drop-off'}
            />
          </View>
        )}

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

        {/* Status Timeline */}
        <View className="px-5 mb-4">
          <Text className="text-sm font-montserrat-bold text-textSecondary mb-3">
            Status Timeline
          </Text>
          {TIMELINE_STEPS.map((step, idx) => {
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
                  {idx < TIMELINE_STEPS.length - 1 && (
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
              <Avatar name={booking.dropoff_contact_name ?? 'Customer'} size="md" />
              <View className="flex-1">
                <Text className="text-sm font-montserrat-bold text-textPrimary">
                  {booking.dropoff_contact_name ?? 'Customer'}
                </Text>
              </View>
            </View>
            <View className="flex-row gap-3">
              <Pressable className="flex-1 flex-row items-center justify-center gap-2 bg-primaryLight rounded-xl py-2">
                <Phone size={16} color="#2563EB" />
                <Text className="text-xs font-montserrat-bold text-primary">Call</Text>
              </Pressable>
              <Pressable
                className="flex-1 flex-row items-center justify-center gap-2 bg-primaryLight rounded-xl py-2"
                onPress={() => router.push(`/(runner)/chat/${booking.id}` as any)}
              >
                <MessageCircle size={16} color="#2563EB" />
                <Text className="text-xs font-montserrat-bold text-primary">Chat</Text>
              </Pressable>
            </View>
          </Card>
        </View>
      </ScrollView>

      {/* Bottom Action Button */}
      <View className="absolute bottom-0 left-0 right-0 bg-background border-t border-divider px-5 py-4 pb-8">
        <StatusActionButton
          status={booking.status}
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

      {/* Completion Modal */}
      {showCompletion && (
        <CompletionModal
          bookingId={booking.id}
          deliveryPhotoUrl={deliveryPhotoUrl}
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
    </SafeAreaView>
  );
}
