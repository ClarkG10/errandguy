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
import { LightColors, Elevation } from '../../constants/colors';
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
      android_ripple={{ color: `${LightColors.primary}0F` }}
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
            <MapPin size={13} color={LightColors.danger} />
          ) : (
            <MapPin size={13} color={LightColors.primary} />
          )}
        </View>
        <Text style={styles.addrText} numberOfLines={2}>
          {activeAddress}
        </Text>
      </View>

      {/* CTA */}
      <Animated.View style={[styles.ctaWrap, { transform: [{ scale: chipScale }] }]}>
        <View style={styles.ctaInner}>
          <ActiveIcon size={14} color={LightColors.textInverse} />
          <Text style={styles.ctaText}>{copy.cta}</Text>
          <ArrowRight size={14} color={LightColors.textInverse} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: LightColors.surface,
    borderRadius: 20,
    padding: 14,
    overflow: 'hidden',
    // Soft diffuse card lift from the shared elevation scale.
    ...Elevation.sm,
    borderWidth: 1,
    borderColor: LightColors.divider,
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
    backgroundColor: LightColors.primary,
    marginRight: 8,
  },
  headerLabel: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textSecondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  amountChip: {
    backgroundColor: LightColors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  amountChipText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: LightColors.primaryDark,
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
    color: LightColors.textPrimary,
  },
  subText: {
    fontSize: 11,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textTertiary,
    marginTop: 2,
  },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: LightColors.surfaceMuted,
    borderRadius: 16,
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
    color: LightColors.textSecondary,
    lineHeight: 17,
  },
  ctaWrap: {
    alignSelf: 'stretch',
  },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LightColors.primary,
    borderRadius: 16,
    paddingVertical: 11,
    gap: 8,
  },
  ctaText: {
    fontSize: 13,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textInverse,
    marginHorizontal: 4,
  },
});
