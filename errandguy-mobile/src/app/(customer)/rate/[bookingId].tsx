import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CheckCircle } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBookingStore } from '../../../stores/bookingStore';
import { bookingService } from '../../../services/booking.service';
import { Avatar } from '../../../components/ui/Avatar';
import { Card } from '../../../components/ui/Card';
import { RatingStars } from '../../../components/ui/RatingStars';
import { PriceBreakdown } from '../../../components/ui/PriceBreakdown';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatDateTime } from '../../../utils/formatDate';
import { LightColors } from '../../../constants/colors';
import type { Booking } from '../../../types';
import { toast } from '../../../stores/toastStore';

const TIP_OPTIONS = [20, 50, 100];

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
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const setActiveBooking = useBookingStore((s) => s.setActiveBooking);

  const [booking, setBooking] = useState<Booking | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [tipAmount, setTipAmount] = useState(0);
  const [customTip, setCustomTip] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!bookingId) return;
    bookingService
      .getBooking(bookingId)
      .then((res) => setBooking(res.data.data))
      .catch(() => {});
  }, [bookingId]);

  const handleSubmit = useCallback(async () => {
    if (!bookingId || rating === 0) return;
    setIsSubmitting(true);
    try {
      await bookingService.reviewBooking(bookingId, {
        rating,
        comment: comment.trim() || undefined,
      });
      setActiveBooking(null);
      router.replace('/(customer)/(tabs)');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to submit review');
    } finally {
      setIsSubmitting(false);
    }
  }, [bookingId, rating, comment, setActiveBooking, router]);

  const handleSkip = useCallback(() => {
    setActiveBooking(null);
    router.replace('/(customer)/(tabs)');
  }, [setActiveBooking, router]);

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
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* Success Header */}
        <View className="items-center pt-8 pb-6">
          <CheckCircle size={64} color={LightColors.success} />
          <Text className="text-2xl font-montserrat-bold text-textPrimary mt-4">
            Errand Completed!
          </Text>
          {booking && (
            <>
              <Text className="text-sm font-montserrat text-textSecondary mt-1">
                {booking.booking_number}
              </Text>
              <Text className="text-xs font-montserrat text-textSecondary mt-0.5">
                {formatDateTime(booking.completed_at ?? booking.updated_at)}
              </Text>
            </>
          )}
        </View>

        {/* Receipt */}
        {booking && (
          <Card className="mx-5 mb-6">
            <Text className="text-base font-montserrat-bold text-textPrimary mb-3">
              Receipt
            </Text>
            <PriceBreakdown
              items={priceItems}
              total={booking.total_amount}
            />
          </Card>
        )}

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

          {/* Quick tags — pill chips; tapping appends the phrase to the
              comment. Selected = soft blue fill + primary border. */}
          <View className="flex-row flex-wrap gap-2 mb-4">
            {QUICK_TAGS.map((tag) => {
              const selected = comment.includes(tag);
              return (
                <Pressable
                  key={tag}
                  onPress={() => {
                    if (selected) return;
                    setComment((prev) => (prev ? `${prev} ${tag}` : tag));
                  }}
                  className={`px-3.5 py-2 rounded-full border ${
                    selected
                      ? 'bg-primaryLight border-primary'
                      : 'bg-surface border-divider'
                  }`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Add "${tag}" to your comment`}
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
          />
        </Card>

        {/* Tip Section */}
        <Card className="mx-5 mb-6">
          <Text className="text-base font-montserrat-bold text-textPrimary mb-3">
            Leave a Tip (optional)
          </Text>
          <View className="flex-row gap-3 mb-3">
            {TIP_OPTIONS.map((amount) => (
              <Pressable
                key={amount}
                className={`flex-1 py-3 rounded-lg border items-center ${
                  tipAmount === amount
                    ? 'bg-primaryLight border-primary'
                    : 'bg-surface border-divider'
                }`}
                onPress={() => {
                  setTipAmount(amount);
                  setCustomTip('');
                }}
              >
                <Text
                  className={`text-sm font-montserrat-bold ${
                    tipAmount === amount
                      ? 'text-primary'
                      : 'text-textPrimary'
                  }`}
                >
                  {formatCurrency(amount)}
                </Text>
              </Pressable>
            ))}
            <Pressable
              className={`flex-1 py-3 rounded-lg border items-center ${
                customTip
                  ? 'bg-primaryLight border-primary'
                  : 'bg-surface border-divider'
              }`}
              onPress={() => {
                setTipAmount(0);
                setCustomTip('');
              }}
            >
              <Text
                className={`text-sm font-montserrat-bold ${
                  customTip
                    ? 'text-primary'
                    : 'text-textPrimary'
                }`}
              >
                Custom
              </Text>
            </Pressable>
          </View>
        </Card>

        {/* Submit */}
        <View className="mx-5 gap-3">
          <Button
            title="Submit Review"
            onPress={handleSubmit}
            disabled={rating === 0}
            loading={isSubmitting}
            fullWidth
          />
          <Pressable className="items-center py-2" onPress={handleSkip}>
            <Text className="text-sm font-montserrat text-textSecondary">
              Skip
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
