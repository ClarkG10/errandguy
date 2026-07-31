import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Animated,
  Easing,
  StyleSheet,
} from 'react-native';
import { ArrowRight, MapPin, Search, Star } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Avatar } from '../ui/Avatar';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { LightColors, Elevation } from '../../constants/colors';
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
  // Cancelled must not read as a completed journey — empty track.
  cancelled: 0,
};

// Short word under the bar naming the current stage. The "step N of 4"
// count is appended at the call site so the slim bar isn't the only
// quantitative cue.
const STAGE_WORD: Record<Phase, string> = {
  searching: 'Finding a runner',
  matched: 'Matched',
  pickup: 'Pickup',
  transit: 'Transit',
  done: 'Completed',
  cancelled: 'Cancelled',
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
  // no_runner shares the 'searching' phase but is NOT an active search —
  // exclude it so the dot stops pulsing and the caption doesn't claim
  // we're still "finding" one while the headline says none are available.
  const isNoRunner = booking.status === 'no_runner';
  const isSearching = phase === 'searching' && !isNoRunner;
  const isCancelled = phase === 'cancelled';
  const reduceMotion = useReducedMotion();

  // One-line progress cue under the bar (e.g. "Transit · step 3 of 4").
  // The bar shows how far along at a glance; this names the stage and
  // quantifies it, which the bar alone can't. The terminal 'done' phase
  // covers both delivered (awaiting confirmation) and completed, so the
  // word is taken from the raw status — never say "Completed" on the card
  // that's asking the customer to confirm completion.
  const stageWord =
    phase === 'done'
      ? booking.status === 'completed'
        ? 'Completed'
        : 'Delivered'
      : STAGE_WORD[phase];
  const stageCaption =
    isCancelled || isNoRunner
      ? null
      : isSearching
      ? 'Finding a runner nearby'
      : `${stageWord} · step ${filled} of 4`;

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
      {/* Header — errand CATEGORY + fare. Not the status: the live status
          is the headline below, so a "EN ROUTE" pill over "Ana is en
          route" only said it twice. The dot alone carries "live" (it
          pulses while searching, turns red if cancelled). Fare is a plain
          ink figure so blue stays reserved for the Track CTA. */}
      <View style={styles.headerRow}>
        <View style={styles.statusBadgeRow}>
          <Animated.View
            style={[
              styles.dot,
              isCancelled && { backgroundColor: LightColors.danger },
              { transform: [{ scale: dotScale }], opacity: dotOpacity },
            ]}
          />
          <Text style={styles.categoryText} numberOfLines={1}>
            {booking.errand_type?.name ?? 'Errand'}
          </Text>
        </View>
        <Text style={styles.amountText}>
          {formatCurrency(booking.total_amount)}
        </Text>
      </View>

      {/* Headline — the single thing that's happening right now. */}
      <Text style={styles.headline} numberOfLines={2}>
        {headline}
      </Text>

      {/* Slim journey bar — a glanceable summary. The stage-by-stage
          stepper with labels lives on the dedicated tracking screen; on
          the home card the headline already names the current stage, so
          repeating it as four labelled checkmarks only crowded the card. */}
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
              i < 3 && { marginRight: 5 },
            ]}
          />
        ))}
      </View>

      {stageCaption ? (
        <Text style={styles.stageCaption}>{stageCaption}</Text>
      ) : null}

      {/* Footer — who's on it + the way in. Flattened onto the card
          behind a hairline (no nested grey box), so the card reads as one
          surface instead of a box-within-a-box. */}
      <View style={styles.footerRow}>
        {booking.runner ? (
          <>
            <Avatar
              uri={booking.runner.avatar_url ?? undefined}
              name={booking.runner.full_name}
              size="sm"
            />
            <View style={styles.footerMeta}>
              <Text style={styles.footerTitle} numberOfLines={1}>
                {booking.runner.full_name}
              </Text>
              {booking.runner.avg_rating != null && (
                <View style={styles.ratingRow}>
                  <Star
                    size={11}
                    color={LightColors.accentStrong}
                    fill={LightColors.accentStrong}
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
          </>
        ) : (
          <>
            <View style={styles.searchIconWrap}>
              <Search size={16} color={PRIMARY} />
            </View>
            <View style={styles.footerMeta}>
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
          </>
        )}
        <View style={styles.trackPill}>
          <Text style={styles.trackPillText}>
            {booking.runner ? 'Track' : 'View'}
          </Text>
          <ArrowRight
            size={13}
            color={LightColors.textInverse}
            style={{ marginLeft: 3 }}
          />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: LightColors.surface,
    borderRadius: 20,
    padding: 16,
    ...Elevation.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
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
  categoryText: {
    fontSize: 11,
    fontFamily: 'Quicksand_700Bold',
    // Muted, not blue — it's an eyebrow-style category label, not a status.
    color: TEXT_SECONDARY,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  amountText: {
    fontSize: 15,
    // Inter for currency (app-wide numeric convention); tabular digits
    // keep the figure steady as the fare updates mid-errand.
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
    color: TEXT_PRIMARY,
  },
  headline: {
    fontSize: 17,
    fontFamily: 'Quicksand_700Bold',
    color: TEXT_PRIMARY,
    lineHeight: 22,
    marginBottom: 14,
  },
  progressTrack: {
    flexDirection: 'row',
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
  stageCaption: {
    fontSize: 11,
    fontFamily: 'Quicksand_600SemiBold',
    color: TEXT_SECONDARY,
    marginTop: 7,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: LightColors.divider,
    marginTop: 14,
    paddingTop: 14,
  },
  footerMeta: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  footerTitle: {
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
    // Neutral chip (blue glyph on top) — matches the app-wide move to
    // quiet, neutral icon chrome so blue/gold read as intentional.
    backgroundColor: LightColors.surfaceMuted,
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
});
