import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, Vibration } from 'react-native';
import { MotiView } from 'moti';
import { MapPin, Navigation, Truck, ShoppingBag } from 'lucide-react-native';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { formatCurrency } from '../../utils/formatCurrency';
import { getErrandTypeRule } from '../../constants/errandTypeRules';
import type { Booking } from '../../types';

interface IncomingRequestModalProps {
  booking: Booking;
  onAccept: () => void | Promise<void>;
  onDecline: () => void | Promise<void>;
  timeoutSeconds?: number;
}

export function IncomingRequestModal({
  booking,
  onAccept,
  onDecline,
  timeoutSeconds = 30,
}: IncomingRequestModalProps) {
  const [remaining, setRemaining] = useState(timeoutSeconds);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);

  const errandRule = getErrandTypeRule(booking.errand_type?.slug);
  const isSingleLocation = errandRule.singleLocation;
  const isShopping = errandRule.requiresShoppingBudget;
  const showDropoff =
    !isSingleLocation &&
    !!booking.dropoff_address &&
    booking.dropoff_address !== booking.pickup_address;

  useEffect(() => {
    Vibration.vibrate([0, 500, 200, 500]);
  }, []);

  useEffect(() => {
    if (accepting || declining) return;
    if (remaining <= 0) {
      onDecline();
      return;
    }
    const timer = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, onDecline, accepting, declining]);

  const handleAccept = useCallback(async () => {
    if (accepting || declining) return;
    setAccepting(true);
    try {
      await onAccept();
    } finally {
      // Parent unmounts the modal on success; reset only if still mounted.
      setAccepting(false);
    }
  }, [onAccept, accepting, declining]);

  const handleDecline = useCallback(async () => {
    if (accepting || declining) return;
    setDeclining(true);
    try {
      await onDecline();
    } finally {
      setDeclining(false);
    }
  }, [onDecline, accepting, declining]);

  const progress = remaining / timeoutSeconds;
  const ringColor = remaining <= 5 ? '#EF4444' : remaining <= 10 ? '#F59E0B' : '#2563EB';

  return (
    <View className="absolute inset-0 bg-black/60 justify-center items-center px-6 z-50">
      <MotiView
        from={{ opacity: 0, scale: 0.92, translateY: 12 }}
        animate={{ opacity: 1, scale: 1, translateY: 0 }}
        transition={{ type: 'spring', damping: 22, stiffness: 240, mass: 0.8 }}
        className="bg-background rounded-3xl p-6 w-full max-w-sm"
      >
        {/* Countdown Ring */}
        <View className="items-center mb-4">
          <View className="w-16 h-16 rounded-full border-4 border-divider items-center justify-center">
            <View
              className="absolute w-16 h-16 rounded-full border-4"
              style={{ opacity: progress, borderColor: ringColor }}
            />
            <Text
              className="text-xl font-montserrat-bold"
              style={{ color: ringColor }}
            >
              {remaining}
            </Text>
          </View>
          <Text className="text-xs font-montserrat text-textSecondary mt-2">
            seconds to respond
          </Text>
        </View>

        {/* Errand Type + Badges */}
        <View className="flex-row items-center flex-wrap gap-2 mb-3">
          <Text className="text-base font-montserrat-bold text-textPrimary">
            {booking.errand_type?.name ?? 'New Errand'}
          </Text>
          {booking.is_transportation && (
            <Badge label="🚗 Transport" variant="primary" size="sm" />
          )}
          {isShopping && (
            <Badge label="🛒 Shopping" variant="danger" size="sm" />
          )}
          {isSingleLocation && (
            <Badge label="📍 On-site" variant="neutral" size="sm" />
          )}
        </View>

        {/* Addresses — hide dropoff for on-site / single-location errands. */}
        <View className="mb-3">
          <View className="flex-row items-start gap-2 mb-1">
            <MapPin size={14} color="#22C55E" />
            <Text className="text-xs font-montserrat text-textSecondary flex-1" numberOfLines={2}>
              {booking.pickup_address}
            </Text>
          </View>
          {showDropoff && (
            <View className="flex-row items-start gap-2">
              <Navigation size={14} color="#EF4444" />
              <Text className="text-xs font-montserrat text-textSecondary flex-1" numberOfLines={2}>
                {booking.dropoff_address}
              </Text>
            </View>
          )}
        </View>

        {/* Shopping Budget banner — runner needs to know spend ceiling before accepting. */}
        {isShopping && booking.shopping_budget != null && (
          <View className="flex-row items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl p-2.5 mb-3">
            <ShoppingBag size={14} color="#B45309" />
            <Text className="text-xs font-montserrat text-amber-800 flex-1">
              Customer budget cap
            </Text>
            <Text className="text-sm font-montserrat-bold text-amber-900">
              {formatCurrency(booking.shopping_budget)}
            </Text>
          </View>
        )}

        {/* Distance + Payout */}
        <View className="flex-row items-center justify-between mb-4 bg-primaryLight rounded-xl p-3">
          <View className="flex-row items-center gap-1">
            <Truck size={14} color="#2563EB" />
            <Text className="text-xs font-montserrat text-primary">
              {booking.distance_km != null && booking.distance_km > 0
                ? `${booking.distance_km} km`
                : 'On-site'}
            </Text>
          </View>
          <Text className="text-xl font-montserrat-bold text-primary">
            {formatCurrency(booking.runner_payout ?? booking.total_amount)}
          </Text>
        </View>

        {booking.is_transportation && (
          <Text className="text-xs font-montserrat text-warning text-center mb-3">
            PIN verification required before ride starts
          </Text>
        )}

        {/* Buttons */}
        <View className="gap-2">
          <Button
            title={accepting ? 'Accepting…' : 'Accept'}
            onPress={handleAccept}
            disabled={accepting || declining}
            loading={accepting}
            fullWidth
          />
          <Button
            title="Decline"
            variant="outline"
            onPress={handleDecline}
            disabled={accepting || declining}
            fullWidth
          />
        </View>
      </MotiView>
    </View>
  );
}

