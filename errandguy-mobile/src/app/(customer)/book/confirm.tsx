import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Alert, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Search, CheckCircle, XCircle } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBookingStore } from '../../../stores/bookingStore';
import { bookingService } from '../../../services/booking.service';
import { Button } from '../../../components/ui/Button';
import type { BookingStatus } from '../../../types';

type SearchState = 'searching' | 'matched' | 'no_runner' | 'cancelled';

export default function ConfirmScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ bookingId?: string }>();
  const { activeBooking, setActiveBooking } = useBookingStore();

  const bookingId = params.bookingId ?? activeBooking?.id;
  const [state, setState] = useState<SearchState>('searching');
  const [bookingNumber, setBookingNumber] = useState(
    activeBooking?.booking_number ?? '',
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for status updates (Supabase Realtime placeholder)
  useEffect(() => {
    if (!bookingId) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await bookingService.getBooking(bookingId);
        const booking = res.data.data;
        if (!booking) return;

        setBookingNumber(booking.booking_number);
        const status: BookingStatus = booking.status;

        if (
          status === 'matched' ||
          status === 'accepted' ||
          status === 'heading_to_pickup'
        ) {
          setState('matched');
          setActiveBooking(booking);
          // Auto-navigate to tracking after 2 seconds
          setTimeout(() => {
            router.replace(`/(customer)/tracking/${bookingId}`);
          }, 2000);
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (status === 'cancelled') {
          setState('cancelled');
          setActiveBooking(null);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // Silently retry
      }
    }, 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [bookingId, router, setActiveBooking]);

  const handleCancel = useCallback(() => {
    Alert.alert(
      'Cancel Booking',
      'Are you sure you want to cancel this booking?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            if (!bookingId) return;
            try {
              await bookingService.cancelBooking(bookingId, 'Customer cancelled');
              setState('cancelled');
              setActiveBooking(null);
              if (pollRef.current) clearInterval(pollRef.current);
              router.replace('/(customer)/(tabs)');
            } catch {
              Alert.alert('Error', 'Failed to cancel booking');
            }
          },
        },
      ],
    );
  }, [bookingId, setActiveBooking, router]);

  return (
    <SafeAreaView className="flex-1 bg-background items-center justify-center px-8">
      {state === 'searching' && (
        <>
          <ActivityIndicator size="large" color="#2563EB" />
          <View className="mt-8 items-center">
            <Search size={48} color="#2563EB" />
          </View>
          <Text className="text-xl font-montserrat-bold text-textPrimary mt-6 text-center">
            Looking for a runner nearby...
          </Text>
          {activeBooking?.pricing_mode === 'negotiate' && (
            <Text className="text-sm font-montserrat text-textSecondary mt-2 text-center">
              Your offer is visible to runners
            </Text>
          )}
          {bookingNumber && (
            <Text className="text-sm font-montserrat text-textSecondary mt-4">
              Booking: {bookingNumber}
            </Text>
          )}
          <View className="mt-8 w-full">
            <Button
              title="Cancel Booking"
              variant="outline"
              onPress={handleCancel}
              fullWidth
            />
          </View>
        </>
      )}

      {state === 'matched' && (
        <>
          <CheckCircle size={64} color="#22C55E" />
          <Text className="text-xl font-montserrat-bold text-textPrimary mt-6 text-center">
            Runner Found!
          </Text>
          <Text className="text-sm font-montserrat text-textSecondary mt-2 text-center">
            Redirecting to tracking...
          </Text>
        </>
      )}

      {state === 'no_runner' && (
        <>
          <XCircle size={64} color="#F59E0B" />
          <Text className="text-xl font-montserrat-bold text-textPrimary mt-6 text-center">
            No runners available
          </Text>
          <Text className="text-sm font-montserrat text-textSecondary mt-2 text-center">
            Try again in a few minutes
          </Text>
          <View className="mt-8 w-full gap-3">
            <Button
              title="Try Again"
              onPress={() => setState('searching')}
              fullWidth
            />
            <Button
              title="Go Home"
              variant="outline"
              onPress={() => router.replace('/(customer)/(tabs)')}
              fullWidth
            />
          </View>
        </>
      )}

      {state === 'cancelled' && (
        <>
          <XCircle size={64} color="#EF4444" />
          <Text className="text-xl font-montserrat-bold text-textPrimary mt-6 text-center">
            Booking Cancelled
          </Text>
          <View className="mt-8 w-full">
            <Button
              title="Go Home"
              onPress={() => router.replace('/(customer)/(tabs)')}
              fullWidth
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}
