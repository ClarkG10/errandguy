import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Animated,
  Easing,
  StyleSheet,
} from 'react-native';
import { ArrowRight, MapPin, Navigation, Package } from 'lucide-react-native';
import { Avatar } from '../ui/Avatar';
import { formatCurrency } from '../../utils/formatCurrency';
import type { Booking, BookingStatus } from '../../types';

interface ActiveRunnerErrandCardProps {
  errand: Booking;
  onPress: () => void;
}

/**
 * Compact, status-aware "current errand" card for the runner home screen.
 *
 * Replaces an absent affordance: previously, a runner who already had
 * an active errand had to navigate to the Errands tab to find it — the
 * home screen showed "Recent Errands" but never the *current* one. If
 * the runner killed and re-opened the app mid-errand, the dashboard
 * looked idle, which is misleading and wastes a tap on every return.
 *
 * The card surfaces the next concrete action ("Head to pickup",
 * "Mark picked up", etc.) so the runner always knows what's expected
 * of them next.
 */

type Phase = 'pickup' | 'pickup_arrived' | 'in_transit' | 'arrived' | 'delivered';

const PHASE_BY_STATUS: Partial<Record<BookingStatus, Phase>> = {
  accepted: 'pickup',
  matched: 'pickup',
  heading_to_pickup: 'pickup',
  arrived_at_pickup: 'pickup_arrived',
  picked_up: 'in_transit',
  in_transit: 'in_transit',
  arrived_at_dropoff: 'arrived',
  delivered: 'delivered',
};

const PHASE_COPY: Record<Phase, { title: string; cta: string; sub: string }> = {
  pickup: {
    title: 'Head to pickup',
    cta: 'Open errand',
    sub: 'Tap to navigate and update status',
  },
  pickup_arrived: {
    title: 'Mark item picked up',
    cta: 'Open errand',
    sub: 'You\u2019ve arrived at pickup',
  },
  in_transit: {
    title: 'En route to drop-off',
    cta: 'Open errand',
    sub: 'Continue navigating to drop-off',
  },
  arrived: {
    title: 'Mark delivered',
    cta: 'Open errand',
    sub: 'You\u2019ve arrived at drop-off',
  },
  delivered: {
    title: 'Confirm completion',
    cta: 'Open errand',
    sub: 'Awaiting customer confirmation',
  },
};

export function ActiveRunnerErrandCard({
  errand,
  onPress,
}: ActiveRunnerErrandCardProps) {
  const phase = PHASE_BY_STATUS[errand.status] ?? 'pickup';
  const copy = PHASE_COPY[phase];
  const customerName = errand.customer?.full_name?.split(' ')[0] ?? 'Customer';
  // While in transit, dropoff is the relevant address; otherwise pickup.
  const showingDropoff = phase === 'in_transit' || phase === 'arrived' || phase === 'delivered';
  const activeAddress = showingDropoff ? errand.dropoff_address : errand.pickup_address;
  const ActiveIcon = showingDropoff ? Package : Navigation;

  // Subtle breathing on the action chip — signals "next thing to do" without
  // being a noisy, attention-stealing pulse.
  const breathe = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);
  const chipScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Active errand for ${customerName}: ${copy.title}`}
      accessibilityHint="Open the errand to update status or navigate"
      android_ripple={{ color: 'rgba(37,99,235,0.06)' }}
      style={({ pressed }) => [
        styles.card,
        pressed && { opacity: 0.96, transform: [{ scale: 0.995 }] },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.brandStripe} />
        <Text style={styles.headerLabel}>Current Errand</Text>
        <View style={styles.amountChip}>
          <Text style={styles.amountChipText}>
            {formatCurrency(errand.runner_payout ?? errand.total_amount)}
          </Text>
        </View>
      </View>

      <View style={styles.bodyRow}>
        <Avatar
          uri={errand.customer?.avatar_url ?? undefined}
          name={errand.customer?.full_name}
          size="md"
        />
        <View style={styles.bodyMeta}>
          <Text style={styles.titleText} numberOfLines={1}>
            {copy.title}
          </Text>
          <Text style={styles.subText} numberOfLines={1}>
            {`${customerName} · ${errand.errand_type?.name ?? 'Errand'}`}
          </Text>
        </View>
      </View>

      {/* Active address row */}
      <View style={styles.addrRow}>
        <View style={styles.addrIconWrap}>
          {showingDropoff ? (
            <MapPin size={13} color="#EF4444" />
          ) : (
            <MapPin size={13} color="#2563EB" />
          )}
        </View>
        <Text style={styles.addrText} numberOfLines={2}>
          {activeAddress}
        </Text>
      </View>

      {/* CTA */}
      <Animated.View style={[styles.ctaWrap, { transform: [{ scale: chipScale }] }]}>
        <View style={styles.ctaInner}>
          <ActiveIcon size={14} color="#FFF" />
          <Text style={styles.ctaText}>{copy.cta}</Text>
          <ArrowRight size={14} color="#FFF" />
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 14,
    overflow: 'hidden',
    // Premium soft shadow with a hint of brand tint.
    shadowColor: '#1D4ED8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  brandStripe: {
    width: 4,
    height: 14,
    borderRadius: 2,
    backgroundColor: '#2563EB',
    marginRight: 8,
  },
  headerLabel: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Quicksand_700Bold',
    color: '#475569',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  amountChip: {
    backgroundColor: '#DBEAFE',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  amountChipText: {
    fontSize: 12,
    fontFamily: 'Quicksand_700Bold',
    color: '#1D4ED8',
  },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  bodyMeta: {
    flex: 1,
    marginLeft: 12,
  },
  titleText: {
    fontSize: 15,
    fontFamily: 'Quicksand_700Bold',
    color: '#0F172A',
  },
  subText: {
    fontSize: 11,
    fontFamily: 'Quicksand_500Medium',
    color: '#64748B',
    marginTop: 2,
  },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  addrIconWrap: {
    marginRight: 8,
    marginTop: 1,
  },
  addrText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Quicksand_500Medium',
    color: '#334155',
    lineHeight: 17,
  },
  ctaWrap: {
    alignSelf: 'stretch',
  },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 11,
    gap: 8,
  },
  ctaText: {
    fontSize: 13,
    fontFamily: 'Quicksand_700Bold',
    color: '#FFF',
    marginHorizontal: 4,
  },
});
