import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ArrowRight, MapPin, Navigation, Package } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Avatar } from '../ui/Avatar';
import { formatRunnerPayout } from '../../utils/runnerPayout';
import { statusActionLabel } from './StatusActionButton';
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
 * The card surfaces the next concrete action — read from the same
 * per-errand-type ladder the cockpit button renders (`statusActionLabel`), so
 * the runner always knows what's expected of them next and the card cannot
 * promise a different verb from the button it opens.
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

/**
 * Supporting line + CTA per phase. The TITLE is no longer here: it used to be
 * a fifth independent action vocabulary that disagreed with the cockpit button
 * it opens ("Mark item picked up" here, "Pick up item" there) and named a
 * drop-off leg that single-location errands don't have \u2014 a queue card read
 * "En route to drop-off". It now comes from `statusActionLabel`, the same
 * per-errand-type ladder the button itself renders.
 */
const PHASE_COPY: Record<Phase, { fallbackTitle: string; cta: string; sub: string }> = {
  pickup: {
    fallbackTitle: 'Head to pickup',
    cta: 'Open errand',
    sub: 'Tap to navigate and update status',
  },
  pickup_arrived: {
    fallbackTitle: 'Continue the errand',
    cta: 'Open errand',
    sub: 'You\u2019ve arrived at pickup',
  },
  in_transit: {
    fallbackTitle: 'Continue the errand',
    cta: 'Open errand',
    sub: 'Continue navigating to drop-off',
  },
  arrived: {
    fallbackTitle: 'Continue the errand',
    cta: 'Open errand',
    sub: 'You\u2019ve arrived at drop-off',
  },
  delivered: {
    fallbackTitle: 'Confirm completion',
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
  // The literal next tap, per errand type — so the card promises exactly what
  // the cockpit button underneath it says.
  const title =
    statusActionLabel(errand.status, errand.errand_type?.slug) ?? copy.fallbackTitle;
  const customerName = errand.customer?.full_name?.split(' ')[0] ?? 'Customer';
  // While in transit, dropoff is the relevant address; otherwise pickup.
  const showingDropoff = phase === 'in_transit' || phase === 'arrived' || phase === 'delivered';
  const activeAddress = showingDropoff ? errand.dropoff_address : errand.pickup_address;
  const ActiveIcon = showingDropoff ? Package : Navigation;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Active errand for ${customerName}: ${title}`}
      accessibilityHint="Open the errand to update status or navigate"
      android_ripple={{ color: `${LightColors.primary}0F` }}
      // Static style only. A function `style={({pressed}) => …}` dropped the
      // card's padding on web (the address row and the CTA ran to the card's
      // edges); the press state rides on className instead.
      className="active:opacity-90"
      style={styles.card}
    >
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>Current errand</Text>
        <Text
          style={styles.amountText}
          accessibilityLabel={`You earn ${formatRunnerPayout(errand.runner_payout)}`}
        >
          {formatRunnerPayout(errand.runner_payout)}
        </Text>
      </View>

      <View style={styles.bodyRow}>
        <Avatar
          uri={errand.customer?.avatar_url ?? undefined}
          name={errand.customer?.full_name}
          size="md"
        />
        <View style={styles.bodyMeta}>
          <Text style={styles.titleText} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.subText} numberOfLines={1}>
            {`${customerName} · ${errand.errand_type?.name ?? 'Errand'}`}
          </Text>
        </View>
      </View>

      {/* Active address — grouped by spacing, not another box in the card. */}
      <View style={styles.addrRow}>
        <MapPin
          size={16}
          color={showingDropoff ? LightColors.danger : LightColors.primary}
          strokeWidth={2}
          style={styles.addrIcon}
        />
        <Text style={styles.addrText} numberOfLines={2}>
          {activeAddress}
        </Text>
      </View>

      {/* CTA — the one thing to do from Home while a job is live. */}
      <View style={styles.ctaInner}>
        <ActiveIcon size={16} color={LightColors.textInverse} strokeWidth={2} />
        <Text style={styles.ctaText}>{copy.cta}</Text>
        <ArrowRight size={16} color={LightColors.textInverse} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

// Card 24 − padding 16 → inner corners 8 (rule 14).
const CARD_RADIUS = 24;
const CARD_PADDING = 16;

const styles = StyleSheet.create({
  card: {
    backgroundColor: LightColors.surface,
    borderRadius: CARD_RADIUS,
    padding: CARD_PADDING,
    overflow: 'hidden',
    // Soft diffuse card lift from the shared elevation scale.
    ...Elevation.sm,
    borderWidth: 1,
    borderColor: LightColors.divider,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  headerLabel: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  // The payout is the figure a runner checks — plain, bold, tabular; no pill.
  amountText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: LightColors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  bodyMeta: {
    flex: 1,
    marginLeft: 12,
  },
  titleText: {
    fontSize: 17,
    lineHeight: 22,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textPrimary,
  },
  subText: {
    fontSize: 13,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textSecondary,
    marginTop: 2,
  },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  addrIcon: {
    marginRight: 10,
    marginTop: 1,
  },
  addrText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textSecondary,
    lineHeight: 20,
  },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LightColors.primary,
    borderRadius: CARD_RADIUS - CARD_PADDING,
    minHeight: 48,
    gap: 8,
  },
  ctaText: {
    fontSize: 15,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textInverse,
  },
});
