import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  MessageCircle,
  Phone,
  Share2,
  MapPin,
  Shield,
  X,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBookingStore } from '../../../stores/bookingStore';
import { bookingService } from '../../../services/booking.service';
import { Avatar } from '../../../components/ui/Avatar';
import { RatingStars } from '../../../components/ui/RatingStars';
import { StatusTimeline } from '../../../components/ui/StatusTimeline';
import { Button } from '../../../components/ui/Button';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatTime } from '../../../utils/formatDate';
import { STATUS_LABELS } from '../../../constants/statusLabels';
import type { Booking, BookingStatus, BookingStatusLog } from '../../../types';

const STANDARD_STEPS: BookingStatus[] = [
  'pending',
  'matched',
  'accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
  'picked_up',
  'in_transit',
  'arrived_at_dropoff',
  'delivered',
  'completed',
];

const TRANSPORT_STEPS: BookingStatus[] = [
  'pending',
  'matched',
  'accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
  'picked_up',
  'in_transit',
  'arrived_at_dropoff',
  'completed',
];

const CAN_CANCEL_STATUSES: BookingStatus[] = [
  'pending',
  'matched',
  'accepted',
  'heading_to_pickup',
];

export default function TrackingScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { setActiveBooking } = useBookingStore();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [statusLogs, setStatusLogs] = useState<BookingStatusLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [sosActive, setSosActive] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch booking data
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      bookingService.getBooking(id),
      bookingService.trackBooking(id),
    ])
      .then(([bookingRes, trackRes]) => {
        const b = bookingRes.data.data;
        setBooking(b);
        setActiveBooking(b);
        setStatusLogs(trackRes.data.data?.status_logs ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, setActiveBooking]);

  // Poll for updates (Supabase Realtime placeholder)
  useEffect(() => {
    if (!id) return;

    pollRef.current = setInterval(async () => {
      try {
        const [bookingRes, trackRes] = await Promise.all([
          bookingService.getBooking(id),
          bookingService.trackBooking(id),
        ]);
        const b = bookingRes.data.data;
        setBooking(b);
        setActiveBooking(b);
        setStatusLogs(trackRes.data.data?.status_logs ?? []);

        if (b?.status === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current);
          router.replace(`/(customer)/rate/${id}`);
        }
      } catch {
        // Retry silently
      }
    }, 10000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id, router, setActiveBooking]);

  const handleCancel = useCallback(() => {
    if (!id) return;
    Alert.alert(
      'Cancel Booking',
      'Are you sure you want to cancel?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              await bookingService.cancelBooking(id);
              setActiveBooking(null);
              router.replace('/(customer)/(tabs)');
            } catch {
              Alert.alert('Error', 'Failed to cancel booking');
            }
          },
        },
      ],
    );
  }, [id, setActiveBooking, router]);

  const handleSOS = useCallback(() => {
    if (!id) return;
    Alert.alert(
      'Emergency SOS',
      'This will alert your trusted contacts and our support team. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm SOS',
          style: 'destructive',
          onPress: async () => {
            try {
              await bookingService.triggerSOS(id);
              setSosActive(true);
            } catch {
              Alert.alert('Error', 'Failed to trigger SOS');
            }
          },
        },
      ],
    );
  }, [id]);

  const handleCall = useCallback(() => {
    // In production, get runner phone from booking relations
    Alert.alert('Call Runner', 'Phone call feature coming soon');
  }, []);

  const handleShareTrip = useCallback(async () => {
    if (!id) return;
    try {
      await bookingService.shareTrip(id);
      Alert.alert('Trip Shared', 'Trip sharing link has been generated');
    } catch {
      Alert.alert('Error', 'Failed to share trip');
    }
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#2563EB" />
      </SafeAreaView>
    );
  }

  if (!booking) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center px-8">
        <Text className="text-lg font-montserrat-bold text-textPrimary">
          Booking not found
        </Text>
        <View className="mt-4">
          <Button
            title="Go Home"
            onPress={() => router.replace('/(customer)/(tabs)')}
          />
        </View>
      </SafeAreaView>
    );
  }

  const isTransportation = booking.is_transportation;
  const steps = isTransportation ? TRANSPORT_STEPS : STANDARD_STEPS;
  const currentStatusIndex = steps.indexOf(booking.status);
  const canCancel = CAN_CANCEL_STATUSES.includes(booking.status);

  const timelineSteps = steps.map((status, index) => {
    const log = statusLogs.find((l) => l.status === status);
    let stepStatus: 'completed' | 'current' | 'pending' = 'pending';
    if (index < currentStatusIndex) stepStatus = 'completed';
    else if (index === currentStatusIndex) stepStatus = 'current';

    return {
      label: STATUS_LABELS[status],
      timestamp: log ? formatTime(log.created_at) : undefined,
      status: stepStatus,
    };
  });

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-5 py-4">
        <Pressable onPress={() => router.back()} className="mr-3">
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-lg font-montserrat-bold text-textPrimary flex-1">
          Tracking
        </Text>
        <Text className="text-xs font-montserrat text-textSecondary">
          {booking.booking_number}
        </Text>
      </View>

      {/* Map Placeholder */}
      <View className="h-[35%] bg-divider items-center justify-center mx-5 rounded-xl overflow-hidden">
        <MapPin size={40} color="#94A3B8" />
        <Text className="text-sm font-montserrat text-textSecondary mt-2">
          Live Map
        </Text>
        <Text className="text-[10px] font-montserrat text-textSecondary mt-1">
          Mapbox integration pending
        </Text>
      </View>

      {/* Bottom Panel */}
      <View className="flex-1 px-5 pt-4">
        {/* Transportation PIN */}
        {isTransportation && booking.ride_pin && (
          <View className="bg-warning/10 border border-warning rounded-xl p-4 mb-4 items-center">
            <Text className="text-xs font-montserrat text-warning mb-1">
              Show this PIN to your runner
            </Text>
            <Text className="text-3xl font-montserrat-bold text-warning tracking-widest">
              {booking.ride_pin}
            </Text>
          </View>
        )}

        {/* Runner Info */}
        {booking.runner_id && (
          <View className="flex-row items-center mb-4">
            <Avatar size="md" />
            <View className="flex-1 ml-3">
              <Text className="text-sm font-montserrat-bold text-textPrimary">
                Runner
              </Text>
              <RatingStars value={4.5} size={14} readonly />
            </View>

            {/* Action Buttons */}
            <View className="flex-row gap-3">
              <Pressable
                className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center"
                onPress={() =>
                  router.push(`/(customer)/chat/${booking.id}`)
                }
              >
                <MessageCircle size={18} color="#2563EB" />
              </Pressable>
              <Pressable
                className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center"
                onPress={handleCall}
              >
                <Phone size={18} color="#2563EB" />
              </Pressable>
              <Pressable
                className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center"
                onPress={handleShareTrip}
              >
                <Share2 size={18} color="#2563EB" />
              </Pressable>
            </View>
          </View>
        )}

        {/* Status Timeline */}
        <View className="flex-1">
          <StatusTimeline steps={timelineSteps} />
        </View>

        {/* Bottom Actions */}
        <View className="pb-6 gap-2">
          {/* SOS Button for Transportation */}
          {isTransportation && !sosActive && (
            <Button
              title="Emergency SOS"
              variant="danger"
              icon={Shield}
              onPress={handleSOS}
              fullWidth
            />
          )}
          {sosActive && (
            <View className="bg-danger/10 border border-danger rounded-xl p-3 items-center">
              <Text className="text-sm font-montserrat-bold text-danger">
                SOS Active — Help is on the way
              </Text>
            </View>
          )}

          {/* Cancel Button */}
          {canCancel && (
            <Button
              title="Cancel Errand"
              variant="outline"
              onPress={handleCancel}
              fullWidth
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
