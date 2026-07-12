import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Animated,
  Easing,
  StyleSheet,
} from 'react-native';
import {
  ArrowRight,
  MapPin,
  Search,
  Star,
  CheckCircle2,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Avatar } from '../ui/Avatar';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { LightColors, Elevation } from '../../constants/colors';
import { STATUS_LABELS } from '../../constants/statusLabels';
import { formatCurrency } from '../../utils/formatCurrency';
import type { Booking, BookingStatus } from '../../types';

interface ActiveBookingCardProps {
  booking: Booking;
  onPress: () => void;
}

type Phase = 'searching' | 'matched' | 'pickup' | 'transit' | 'done' | 'cancelled';

const PHASE_BY_STATUS: Record<BookingStatus, Phase> = {
  pending: 'searching',
  no_runner: 'searching',
  matched: 'matched',
  accepted: 'matched',
  heading_to_pickup: 'pickup',
  arrived_at_pickup: 'pickup',
  picked_up: 'transit',
  in_transit: 'transit',
  arrived_at_dropoff: 'transit',
  delivered: 'done',
  completed: 'done',
  cancelled: 'cancelled',
};

const FILLED_SEGMENTS: Record<Phase, number> = {
  searching: 0,
  matched: 1,
  pickup: 2,
  transit: 3,
  done: 4,
  // Cancelled must not read as a completed journey — empty track, no
  // stage checkmarks (filled 0 suppresses them all).
  cancelled: 0,
};

function headlineFor(
  status: BookingStatus,
  runnerFirstName?: string | null,
): string {
  const name = runnerFirstName ?? 'Runner';
  switch (status) {
    case 'pending':
      return 'Looking for a runner nearby…';
    case 'no_runner':
      return 'No runners available yet';
    case 'matched':
      return `${name} matched — confirming…`;
    case 'accepted':
      return `${name} is on the way`;
    case 'heading_to_pickup':
      return `${name} is heading to pickup`;
    case 'arrived_at_pickup':
      return `${name} arrived at pickup`;
    case 'picked_up':
      return `${name} picked up your item`;
    case 'in_transit':
      return `${name} is en route`;
    case 'arrived_at_dropoff':
      return `${name} arrived at drop-off`;
    case 'delivered':
      return 'Delivered — confirm to complete';
    case 'completed':
      return 'Errand completed';
    case 'cancelled':
      return 'Errand cancelled';
  }
}

const PRIMARY = LightColors.primary;
const TEXT_PRIMARY = LightColors.textPrimary;
const TEXT_SECONDARY = LightColors.textTertiary;
const TRACK_EMPTY = LightColors.divider;

export function ActiveBookingCard({ booking, onPress }: ActiveBookingCardProps) {
  const phase = PHASE_BY_STATUS[booking.status];
  const filled = FILLED_SEGMENTS[phase];
  const runnerName = booking.runner?.full_name?.split(' ')[0] ?? null;
  const headline = headlineFor(booking.status, runnerName);
  const isSearching = phase === 'searching';
  const isCancelled = phase === 'cancelled';
  const reduceMotion = useReducedMotion();

  // Pulsing status dot — only animates while searching so the card
  // doesn't waste cycles once a runner is matched. Frozen to a static
  // dot when the OS "Reduce Motion" setting is on.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isSearching || reduceMotion) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isSearching, reduceMotion, pulse]);

  const dotScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.5],
  });
  const dotOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.45],
  });

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Active errand: ${headline}. Tap to track.`}
      android_ripple={{ color: 'rgba(37,99,235,0.08)' }}
      style={({ pressed }) => [
        styles.card,
        pressed && { opacity: 0.97, transform: [{ scale: 0.997 }] },
      ]}
    >
      {/* Status row */}
      <View style={styles.statusRow}>
        <View style={styles.statusBadgeRow}>
          <Animated.View
            style={[
              styles.dot,
              // Base danger tone for the fill, dangerDark for the 11px
              // text — per the small-text status convention.
              isCancelled && { backgroundColor: LightColors.danger },
              { transform: [{ scale: dotScale }], opacity: dotOpacity },
            ]}
          />
          <Text
            style={[
              styles.statusBadgeText,
              isCancelled && { color: LightColors.dangerDark },
            ]}
          >
            {STATUS_LABELS[booking.status] ?? 'Active'}
          </Text>
        </View>
        <View style={styles.amountChip}>
          <Text style={styles.amountChipText}>
            {formatCurrency(booking.total_amount)}
          </Text>
        </View>
      </View>

      {/* Headline */}
      <Text style={styles.headline} numberOfLines={2}>
        {headline}
      </Text>

      {/* Runner / search block */}
      {booking.runner ? (
        <View style={styles.infoRow}>
          <Avatar
            uri={booking.runner.avatar_url ?? undefined}
            name={booking.runner.full_name}
            size="sm"
          />
          <View style={styles.infoMeta}>
            <Text style={styles.infoTitle} numberOfLines={1}>
              {booking.runner.full_name}
            </Text>
            {booking.runner.avg_rating != null && (
              <View style={styles.ratingRow}>
                <Star
                  size={11}
                  color={LightColors.warning}
                  fill={LightColors.warning}
                />
                <Text style={styles.ratingText}>
                  {Number(booking.runner.avg_rating).toFixed(1)}
                </Text>
                {booking.runner.total_ratings ? (
                  <Text style={styles.ratingCount}>
                    {' · '}
                    {booking.runner.total_ratings} trips
                  </Text>
                ) : null}
              </View>
            )}
          </View>
          <View style={styles.trackPill}>
            <Text style={styles.trackPillText}>Track</Text>
            <ArrowRight
              size={13}
              color={LightColors.textInverse}
              style={{ marginLeft: 3 }}
            />
          </View>
        </View>
      ) : (
        <View style={styles.infoRow}>
          <View style={styles.searchIconWrap}>
            <Search size={16} color={PRIMARY} />
          </View>
          <View style={styles.infoMeta}>
            <View style={styles.addrRow}>
              <MapPin size={11} color={TEXT_SECONDARY} />
              <Text style={styles.addrText} numberOfLines={1}>
                {booking.pickup_address}
              </Text>
            </View>
            <View style={[styles.addrRow, { marginTop: 2 }]}>
              <MapPin size={11} color={TEXT_SECONDARY} />
              <Text style={styles.addrText} numberOfLines={1}>
                {booking.dropoff_address}
              </Text>
            </View>
          </View>
          <View style={styles.trackPill}>
            <Text style={styles.trackPillText}>View</Text>
            <ArrowRight
              size={13}
              color={LightColors.textInverse}
              style={{ marginLeft: 3 }}
            />
          </View>
        </View>
      )}

      {/* Progress segments */}
      <View
        style={styles.progressTrack}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 4, now: filled }}
      >
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.progressSegment,
              i < filled
                ? styles.progressSegmentFilled
                : styles.progressSegmentEmpty,
              i < 3 && { marginRight: 4 },
            ]}
          />
        ))}
      </View>

      {/* Stage labels */}
      <View style={styles.stageLabelsRow}>
        <StageLabel label="Match" done={filled >= 1} />
        <StageLabel label="Pickup" done={filled >= 2} />
        <StageLabel label="Transit" done={filled >= 3} />
        <StageLabel label="Done" done={filled >= 4} />
      </View>
    </Pressable>
  );
}

function StageLabel({ label, done }: { label: string; done: boolean }) {
  return (
    <View style={styles.stageLabelWrap}>
      {done ? (
        <CheckCircle2
          size={10}
          color={PRIMARY}
          style={{ marginRight: 3 }}
        />
      ) : null}
      <Text
        style={[
          styles.stageLabelText,
          { color: done ? PRIMARY : TEXT_SECONDARY },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: LightColors.surface,
    borderRadius: 20,
    padding: 16,
    ...Elevation.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PRIMARY,
    marginRight: 7,
  },
  statusBadgeText: {
    fontSize: 11,
    fontFamily: 'Quicksand_700Bold',
    color: PRIMARY,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  amountChip: {
    backgroundColor: LightColors.primaryLight,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  amountChipText: {
    fontSize: 12,
    // Inter for currency (app-wide numeric convention); tabular digits
    // keep the chip width stable as the fare updates mid-errand.
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: PRIMARY,
  },
  headline: {
    fontSize: 16,
    fontFamily: 'Quicksand_700Bold',
    color: TEXT_PRIMARY,
    lineHeight: 21,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LightColors.surfaceMuted,
    borderRadius: 16,
    padding: 10,
  },
  infoMeta: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  infoTitle: {
    fontSize: 13,
    fontFamily: 'Quicksand_700Bold',
    color: TEXT_PRIMARY,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  ratingText: {
    fontSize: 11,
    fontFamily: 'Quicksand_600SemiBold',
    color: TEXT_PRIMARY,
    marginLeft: 3,
  },
  ratingCount: {
    fontSize: 11,
    fontFamily: 'Quicksand_500Medium',
    color: TEXT_SECONDARY,
  },
  searchIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: LightColors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addrText: {
    fontSize: 11,
    fontFamily: 'Quicksand_500Medium',
    color: TEXT_PRIMARY,
    marginLeft: 4,
    flex: 1,
  },
  trackPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PRIMARY,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  trackPillText: {
    fontSize: 11,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textInverse,
  },
  progressTrack: {
    flexDirection: 'row',
    marginTop: 14,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  progressSegmentFilled: {
    backgroundColor: PRIMARY,
  },
  progressSegmentEmpty: {
    backgroundColor: TRACK_EMPTY,
  },
  stageLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  stageLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stageLabelText: {
    fontSize: 10,
    fontFamily: 'Quicksand_600SemiBold',
    letterSpacing: 0.2,
  },
});
