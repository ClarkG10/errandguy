import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Platform,
  AccessibilityInfo,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CheckCircle } from 'lucide-react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useBookingStore } from '../../../stores/bookingStore';
import { bookingService } from '../../../services/booking.service';
import { Avatar } from '../../../components/ui/Avatar';
import { Card } from '../../../components/ui/Card';
import { RatingStars } from '../../../components/ui/RatingStars';
import { PriceBreakdown } from '../../../components/ui/PriceBreakdown';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { ErrorState } from '../../../components/ui/ErrorState';
import { SuccessCheck } from '../../../components/ui/SuccessCheck';
import { Skeleton } from '../../../components/ui/Skeleton';
import { formatDateTime } from '../../../utils/formatDate';
import { LightColors } from '../../../constants/colors';
import { useResponsive } from '../../../constants/responsive';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import type { Booking } from '../../../types';
import { toast } from '../../../stores/toastStore';

// NOTE: the tip UI (₱20/50/100 chips) was removed on purpose — the API's
// ReviewRequest accepts ONLY `rating` + `comment`, so the chips collected
// money intentions that were silently dropped. Re-add a tip section once
// the backend supports tips end-to-end (payment capture + runner payout).

// Quick compliment tags — tapping one appends the phrase into the
// comment field (purely a text shortcut; the review payload is
// unchanged). Selected state derives from the comment content.
const QUICK_TAGS = [
  'Fast delivery',
  'Friendly',
  'Great communication',
  'Careful with items',
];

export default function RateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useResponsive();
  const reduceMotion = useReducedMotion();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const setActiveBooking = useBookingStore((s) => s.setActiveBooking);

  const [booking, setBooking] = useState<Booking | null>(null);
  // 'loading' → skeleton receipt; 'error' → compact retry row; 'ready' →
  // real receipt. The rating card stays usable in every state.
  const [bookingState, setBookingState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Post-submit celebration overlay — shown briefly (SuccessCheck fires
  // its own success haptic), then we navigate home from onDone.
  const [showSuccess, setShowSuccess] = useState(false);

  const fetchBooking = useCallback(() => {
    if (!bookingId) return;
    setBookingState('loading');
    bookingService
      .getBooking(bookingId)
      .then((res) => {
        setBooking(res.data.data);
        setBookingState('ready');
      })
      .catch(() => setBookingState('error'));
  }, [bookingId]);

  useEffect(() => {
    fetchBooking();
  }, [fetchBooking]);

  const finishAndGoHome = useCallback(() => {
    setActiveBooking(null);
    router.replace('/(customer)/(tabs)');
  }, [setActiveBooking, router]);

  const handleSubmit = useCallback(async () => {
    if (!bookingId || rating === 0) return;
    setIsSubmitting(true);
    try {
      await bookingService.reviewBooking(bookingId, {
        rating,
        comment: comment.trim() || undefined,
      });
      // The overlay is purely visual — announce the outcome so screen
      // readers get a confirmation before the route swaps home.
      AccessibilityInfo.announceForAccessibility(
        'Review submitted. Thanks for the feedback!'
      );
      // Brief celebratory beat before leaving — SuccessCheck handles the
      // success haptic and calls onDone once the animation settles.
      setShowSuccess(true);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to submit review');
    } finally {
      setIsSubmitting(false);
    }
  }, [bookingId, rating, comment]);

  const handleSkip = useCallback(() => {
    finishAndGoHome();
  }, [finishAndGoHome]);

  // Shared pressed-state for the tag chips and Skip — same recipe as the
  // tracking chrome: scale + opacity, opacity only under Reduce Motion.
  const pressFx = (pressed: boolean) =>
    pressed
      ? reduceMotion
        ? { opacity: 0.7 }
        : { opacity: 0.85, transform: [{ scale: 0.97 }] }
      : null;

  const priceItems = booking
    ? [
        { label: 'Base Fee', amount: booking.base_fee },
        { label: 'Distance Fee', amount: booking.distance_fee },
        { label: 'Convenience Fee', amount: booking.service_fee },
        { label: 'Surcharge', amount: booking.surcharge },
        ...(booking.promo_discount > 0
          ? [{ label: 'Promo Discount', amount: -booking.promo_discount }]
          : []),
      ]
    : [];

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        // First tap on Submit/Skip/chips must act while the keyboard is
        // open, and the comment field has to rise above the iOS keyboard
        // (Android is handled by softwareKeyboardLayoutMode: 'resize').
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        // accessibilityViewIsModal on the overlay is iOS-only; this is the
        // Android half — TalkBack must not reach Submit/Skip while the
        // success celebration covers them.
        importantForAccessibility={showSuccess ? 'no-hide-descendants' : 'auto'}
        contentContainerStyle={{
          // Clamp to a readable column on tablets, same as the booking
          // funnel screens; phones pass through untouched.
          maxWidth: contentMaxWidth,
          width: '100%',
          alignSelf: 'center',
          // Scrolled-to-end Skip must clear the home-indicator gesture
          // region on notched devices (insets.bottom is 0 on the SE).
          paddingBottom: insets.bottom + 32,
        }}
      >
        {/* Success Header */}
        <View className="items-center pt-8 pb-6">
          <CheckCircle size={64} color={LightColors.success} />
          <Text className="text-2xl font-montserrat-bold text-textPrimary mt-4">
            Errand Completed!
          </Text>
          {booking && (
            <>
              {/* Inter, per the data-type convention — booking numbers are
                  reference data, not prose. */}
              <Text className="text-sm font-inter text-textSecondary mt-1">
                {booking.booking_number}
              </Text>
              <Text className="text-xs font-montserrat text-textSecondary mt-0.5">
                {formatDateTime(booking.completed_at ?? booking.updated_at)}
              </Text>
            </>
          )}
        </View>

        {/* Receipt — skeleton while loading, compact retry on failure. */}
        {bookingState === 'loading' ? (
          <Card className="mx-5 mb-6">
            <Skeleton width={72} height={16} borderRadius={4} />
            {/* Four rows — the live receipt always shows base, distance,
                convenience and surcharge, so the card keeps its height
                when the data lands. */}
            {[1, 2, 3, 4].map((i) => (
              <View key={i} className="flex-row items-center justify-between mt-3.5">
                <Skeleton width={110} height={12} borderRadius={4} />
                <Skeleton width={56} height={12} borderRadius={4} />
              </View>
            ))}
            <View className="flex-row items-center justify-between mt-4">
              <Skeleton width={60} height={14} borderRadius={4} />
              <Skeleton width={72} height={14} borderRadius={4} />
            </View>
          </Card>
        ) : bookingState === 'error' ? (
          <Card className="mx-5 mb-6">
            <ErrorState
              compact
              title="Couldn't load your receipt"
              description="You can still rate your runner below."
              onRetry={fetchBooking}
            />
          </Card>
        ) : booking ? (
          <Card className="mx-5 mb-6">
            <Text className="text-base font-montserrat-bold text-textPrimary mb-3">
              Receipt
            </Text>
            <PriceBreakdown
              items={priceItems}
              total={booking.total_amount}
            />
          </Card>
        ) : null}

        {/* Rating Section */}
        <Card className="mx-5 mb-6">
          <View className="items-center mb-4">
            <Avatar
              size="xl"
              uri={booking?.runner?.avatar_url ?? undefined}
              name={booking?.runner?.full_name}
            />
            <Text className="text-base font-montserrat-bold text-textPrimary mt-2">
              {booking?.runner?.full_name
                ? `Rate ${booking.runner.full_name.split(' ')[0]}`
                : 'Rate your Runner'}
            </Text>
          </View>
          <View className="items-center mb-4">
            <RatingStars value={rating} onChange={setRating} size={36} />
          </View>

          {/* Quick tags — pill chips; tapping toggles the phrase in the
              comment (append / strip). Purely a text shortcut, so the
              selected state derives from the comment content and survives
              manual edits. Selected = soft blue fill + primary border. */}
          <View className="flex-row flex-wrap gap-2 mb-4">
            {QUICK_TAGS.map((tag) => {
              const selected = comment.includes(tag);
              return (
                <Pressable
                  key={tag}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setComment((prev) => {
                      const idx = prev.indexOf(tag);
                      if (idx === -1) return prev ? `${prev} ${tag}` : tag;
                      // Strip the phrase, then collapse the seam it
                      // leaves behind so surrounding text stays clean.
                      return (prev.slice(0, idx) + prev.slice(idx + tag.length))
                        .replace(/\s{2,}/g, ' ')
                        .trim();
                    });
                  }}
                  // 36pt chip + 4pt slop = 44pt target, and the 8pt total
                  // vertical bleed never exceeds the 8pt wrap gap — the old
                  // 6pt slop overlapped hit rects between wrapped rows, so
                  // taps in the seam resolved by sibling order.
                  hitSlop={{ top: 4, bottom: 4 }}
                  // Rest state is a muted fill (the app's chip/input
                  // convention), not bg-surface — a white chip on the white
                  // Card with a divider hairline (~1.05:1) read as bare text,
                  // not a tappable pill. Border stays 1px in both states so
                  // toggling to the blue selected border never shifts layout.
                  className={`px-3.5 py-2 rounded-full border ${
                    selected
                      ? 'bg-primaryLight border-primary'
                      : 'bg-surfaceMuted border-transparent'
                  }`}
                  style={({ pressed }) => [
                    { minHeight: 36, justifyContent: 'center' },
                    pressFx(pressed),
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={
                    selected
                      ? `Remove "${tag}" from your comment`
                      : `Add "${tag}" to your comment`
                  }
                >
                  <Text
                    className={`text-xs font-montserrat-semi ${
                      selected ? 'text-primary' : 'text-textSecondary'
                    }`}
                  >
                    {tag}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Input
            label="Comment (optional)"
            value={comment}
            onChangeText={setComment}
            placeholder="How was your experience?"
            multiline
            numberOfLines={3}
            maxLength={500}
            // maxLength truncates silently — surface a countdown over the
            // last 100 characters so long reviews aren't cut off unnoticed.
            helperText={
              comment.length >= 400
                ? `${500 - comment.length} characters left`
                : undefined
            }
          />
        </Card>

        {/* Submit */}
        <View className="mx-5 gap-3">
          <Button
            title="Submit Review"
            onPress={handleSubmit}
            disabled={rating === 0}
            loading={isSubmitting}
            loadingTitle="Submitting…"
            fullWidth
          />
          <Pressable
            className="items-center py-2"
            onPress={handleSkip}
            accessibilityRole="button"
            accessibilityLabel="Skip rating"
            hitSlop={8}
            style={({ pressed }) => pressFx(pressed)}
          >
            <Text className="text-sm font-montserrat text-textSecondary">
              Skip
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Submit-success overlay — a short "thanks" beat with the animated
          check + confetti, then straight home. Blocks touches underneath
          so the review can't be double-submitted while it plays. */}
      {showSuccess && (
        // accessibilityViewIsModal keeps SR focus off the visually
        // covered Submit/Skip controls while the celebration plays.
        <View style={styles.successOverlay} accessibilityViewIsModal>
          <SuccessCheck
            size={96}
            celebrate
            // Small extra beat after the animation settles so the copy is
            // actually readable before the screen swaps away.
            onDone={() => setTimeout(finishAndGoHome, 450)}
          />
          <Text className="text-lg font-montserrat-bold text-textPrimary mt-5">
            Thanks for the feedback!
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: LightColors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
