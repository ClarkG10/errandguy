import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { CheckCircle, Repeat, Gift, Check } from 'lucide-react-native';
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
import { Illustration } from '../../../components/ui/Illustration';
import { Skeleton } from '../../../components/ui/Skeleton';
import { formatDateTime } from '../../../utils/formatDate';
import { errorMessage } from '../../../utils/errorCatalog';
import { haptics } from '../../../utils/haptics';
import { LightColors } from '../../../constants/colors';
import { copy } from '../../../constants/copy';
import { useResponsive } from '../../../constants/responsive';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import type { Booking } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { paymentService } from '../../../services/payment.service';
import { PaymentProgress } from '../../../components/ui/PaymentProgress';
import { usePaymentStore, isAttemptActive } from '../../../stores/paymentStore';
import { usePaymentVerification } from '../../../hooks/usePaymentVerification';
import { openCheckoutUrl, PAYMENT_RETURN_URL } from '../../../utils/browser';
import { mapFailureReason } from '../../../utils/paymentErrors';
import { invalidateQuery } from '../../../hooks/useQuery';
import { formatCurrency } from '../../../utils/formatCurrency';

// Tip is funded from the customer's wallet when the balance covers it, and
// otherwise paid directly online (GCash / Maya / card) via Xendit — so a
// zero-wallet / COD customer can still tip. 100% goes to the runner either way.
const TIP_METHOD_LABEL: Record<'gcash' | 'maya' | 'card', string> = {
  gcash: 'GCash',
  maya: 'Maya',
  card: 'Card',
};

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
  const clearDraft = useBookingStore((s) => s.clearDraft);

  const [booking, setBooking] = useState<Booking | null>(null);
  // 'loading' → skeleton receipt; 'error' → compact retry row; 'ready' →
  // real receipt. The rating card stays usable in every state.
  const [bookingState, setBookingState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Optional tip (₱). Decoupled from the review submit: a tip is a distinct
  // money action (the gateway path leaves the app for checkout), so a tip issue
  // never blocks the review and vice-versa.
  const [tipAmount, setTipAmount] = useState(0);
  const [tipStatus, setTipStatus] = useState<'idle' | 'sending' | 'done'>('idle');
  const [tipMethod, setTipMethod] = useState<'gcash' | 'maya' | 'card'>('gcash');
  // Wallet balance decides wallet-vs-gateway funding. null = still loading.
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  // Forced on when a wallet tip is rejected for insufficient balance — flips the
  // UI to the online (gateway) method picker.
  const [forceGateway, setForceGateway] = useState(false);
  const tipLatch = useRef(false);

  // Gateway-tip verification infra (shared with top-up / booking checkout).
  const beginAttempt = usePaymentStore((s) => s.beginAttempt);
  const setAttemptStatus = usePaymentStore((s) => s.setStatus);
  const resolveAttempt = usePaymentStore((s) => s.resolve);
  const { attempt, stage: verifyStage, isOffline } = usePaymentVerification();
  // Post-submit celebration overlay — shown briefly (SuccessCheck fires
  // its own success haptic), then we navigate home from onDone.
  const [showSuccess, setShowSuccess] = useState(false);
  // Once the check animation settles we reveal a couple of calm, optional
  // next-steps (Book again / Invite a friend) under the celebration. They
  // never block the auto-return — a pending timer still carries the user
  // home; tapping a step (or "Not now") just pre-empts and clears it.
  const [showNextSteps, setShowNextSteps] = useState(false);
  const autoReturnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelAutoReturn = useCallback(() => {
    if (autoReturnTimer.current) {
      clearTimeout(autoReturnTimer.current);
      autoReturnTimer.current = null;
    }
  }, []);

  // Never leave a timer running if the screen unmounts mid-celebration.
  useEffect(() => cancelAutoReturn, [cancelAutoReturn]);

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
    cancelAutoReturn();
    setActiveBooking(null);
    router.replace('/(customer)/(tabs)');
  }, [cancelAutoReturn, setActiveBooking, router]);

  // Re-book the same errand type — clear the finished booking + any stale
  // draft, then seed the type picker with this errand's type (the same
  // startBooking recipe used on Home). Replace, not push: the rate screen
  // is done, so it shouldn't linger in the back stack behind the funnel.
  const handleBookAgain = useCallback(() => {
    cancelAutoReturn();
    haptics.light();
    clearDraft();
    setActiveBooking(null);
    router.replace(
      booking?.errand_type_id
        ? {
            pathname: '/(customer)/book/type',
            params: { preselected: booking.errand_type_id },
          }
        : '/(customer)/book/type',
    );
  }, [cancelAutoReturn, clearDraft, setActiveBooking, router, booking?.errand_type_id]);

  const handleInvite = useCallback(() => {
    cancelAutoReturn();
    haptics.light();
    setActiveBooking(null);
    router.replace('/(customer)/referral');
  }, [cancelAutoReturn, setActiveBooking, router]);

  const handleSubmit = useCallback(async () => {
    // In-flight guard (defense-in-depth beyond the Button's disabled state): a
    // same-frame double-tap can fire two onPress calls before the re-render
    // commits, and reviewBooking is a plain non-idempotent POST.
    if (!bookingId || rating === 0 || isSubmitting) return;
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
      // A 422 is the backend's "already reviewed" no-op — the review IS
      // recorded (a double-tap or a retry after a client-perceived timeout can
      // trigger it). Treat it as success, matching the runner review handler,
      // instead of the misleading "couldn't submit your review" error.
      if (err?.response?.status === 422) {
        AccessibilityInfo.announceForAccessibility(
          'Review already submitted. Thanks for the feedback!'
        );
        setShowSuccess(true);
        return;
      }
      haptics.error();
      toast.error(errorMessage(err, copy.booking.rateFailed));
    } finally {
      setIsSubmitting(false);
    }
  }, [bookingId, rating, comment, isSubmitting]);

  const handleSkip = useCallback(() => {
    finishAndGoHome();
  }, [finishAndGoHome]);

  // Wallet balance decides whether the tip is funded instantly from the wallet
  // or paid online. Best-effort — a failed fetch just defaults to the online
  // (gateway) path, which works for everyone.
  useEffect(() => {
    let alive = true;
    paymentService
      .getWalletBalance()
      .then((res: any) => {
        if (alive) setWalletBalance(Number(res?.data?.data?.balance ?? 0));
      })
      .catch(() => {
        if (alive) setWalletBalance(0);
      });
    return () => {
      alive = false;
    };
  }, []);

  const runnerFirstName = booking?.runner?.full_name?.split(' ')[0];
  // Wallet path only when we KNOW the balance covers the tip; otherwise (unknown
  // or short, or forced after an insufficient-balance rejection) pay online.
  const useWalletPath =
    !forceGateway && walletBalance != null && walletBalance >= tipAmount;

  // Instant, wallet-funded tip. On an insufficient-balance rejection, flip to
  // the online method picker instead of failing the whole action.
  const sendWalletTip = useCallback(async () => {
    if (!bookingId || tipAmount <= 0 || tipLatch.current) return;
    tipLatch.current = true;
    setTipStatus('sending');
    try {
      await bookingService.tip(bookingId, tipAmount);
      setTipStatus('done');
      setWalletBalance((b) => (b == null ? b : Math.max(0, b - tipAmount)));
      invalidateQuery(['wallet']);
      haptics.success();
      toast.success('Tip sent — thank you!');
    } catch (err: any) {
      setTipStatus('idle');
      if (err?.code === 'INSUFFICIENT_WALLET_BALANCE') {
        setForceGateway(true);
        toast.info('Not enough wallet balance — pay the tip with GCash, Maya, or a card.');
      } else if (err?.code === 'CONFLICT') {
        setTipStatus('done'); // already tipped elsewhere
        toast.info('You’ve already tipped this errand.');
      } else {
        haptics.error();
        toast.error(errorMessage(err, 'Could not send the tip. Please try again.'));
      }
    } finally {
      tipLatch.current = false;
    }
  }, [bookingId, tipAmount]);

  // Gateway-funded tip — pay the tip directly online (no wallet needed). Mirrors
  // the top-up checkout: create the charge, open Xendit, VERIFY the outcome.
  const payGatewayTip = useCallback(async () => {
    if (!bookingId || tipAmount <= 0) return;
    if (isAttemptActive(usePaymentStore.getState().attempt)) {
      toast.info("We're still confirming your last payment — hang tight.");
      return;
    }
    if (tipLatch.current) return;
    tipLatch.current = true;
    const payAttempt = beginAttempt({ kind: 'tip', amount: tipAmount, method: tipMethod, bookingId });
    setTipStatus('sending');
    try {
      const res = await bookingService.tipCheckout(bookingId, tipAmount, tipMethod, {
        idempotencyKey: payAttempt.idempotencyKey,
      });
      const checkoutUrl: string | undefined = res.data?.checkout_url;
      const txId: string | undefined = res.data?.data?.id;
      if (!checkoutUrl) {
        resolveAttempt();
        setTipStatus('idle');
        toast.error('Could not start the tip payment. Please try again.');
        return;
      }
      setAttemptStatus('awaiting_gateway', { topupId: txId, checkoutUrl });
      const outcome = await openCheckoutUrl(checkoutUrl, PAYMENT_RETURN_URL);
      if (outcome === 'failed') {
        resolveAttempt();
        setTipStatus('idle');
        toast.error('Couldn’t open checkout — you weren’t charged. Please try again.');
        return;
      }
      if (outcome === 'cancelled') {
        resolveAttempt();
        setTipStatus('idle');
        invalidateQuery(['wallet']);
        toast.info('Checkout cancelled. If you paid, your runner’s tip updates shortly.');
        return;
      }
      // Back from checkout → let usePaymentVerification confirm the truth.
      setAttemptStatus('verifying');
    } catch (err: any) {
      resolveAttempt();
      setTipStatus('idle');
      haptics.error();
      toast.error(errorMessage(err, 'Could not start the tip payment. You weren’t charged.'));
    } finally {
      tipLatch.current = false;
    }
  }, [bookingId, tipAmount, tipMethod, beginAttempt, setAttemptStatus, resolveAttempt]);

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
            <View className="flex-row items-center gap-2 mb-3">
              <Illustration name="3d-receipt" size={26} />
              <Text className="text-base font-montserrat-bold text-textPrimary">
                Receipt
              </Text>
            </View>
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

          {/* Optional tip — wallet-funded when the balance covers it, otherwise
              paid online (GCash / Maya / card) so a zero-wallet / COD customer
              can still tip. 100% goes to the runner either way. */}
          {booking && booking.runner && (
            <View className="mt-4 pt-4 border-t border-divider">
              {tipStatus === 'done' ? (
                <View className="flex-row items-center justify-center gap-1.5 py-1">
                  <Check size={16} color={LightColors.successDark} strokeWidth={2.5} />
                  <Text className="text-sm font-montserrat-semi text-textPrimary">
                    Tip sent — thank you!
                  </Text>
                </View>
              ) : (
                <>
                  <Text className="text-sm font-montserrat-semi text-textPrimary mb-2 text-center">
                    {runnerFirstName ? `Add a tip for ${runnerFirstName}?` : 'Add a tip?'}
                  </Text>
                  <View className="flex-row justify-center gap-2">
                    {[20, 50, 100].map((amt) => {
                      const selected = tipAmount === amt;
                      return (
                        <Pressable
                          key={amt}
                          onPress={() => {
                            Haptics.selectionAsync().catch(() => {});
                            setTipAmount((prev) => (prev === amt ? 0 : amt));
                          }}
                          hitSlop={{ top: 4, bottom: 4 }}
                          className={`px-5 py-2 rounded-full border ${
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
                          accessibilityLabel={`Tip ${amt} pesos`}
                        >
                          <Text
                            className={`text-sm font-montserrat-semi ${
                              selected ? 'text-primary' : 'text-textSecondary'
                            }`}
                          >
                            ₱{amt}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {tipAmount > 0 && (
                    <View className="mt-3">
                      {useWalletPath ? (
                        <>
                          <Button
                            title={`Send ₱${tipAmount} tip`}
                            onPress={sendWalletTip}
                            loading={tipStatus === 'sending'}
                            loadingTitle="Sending…"
                            fullWidth
                          />
                          <Text className="text-[11px] font-montserrat text-textMuted mt-2 text-center">
                            Paid from your wallet
                            {walletBalance != null ? ` (${formatCurrency(walletBalance)})` : ''} — 100% goes to your runner.
                          </Text>
                        </>
                      ) : (
                        <>
                          <Text className="text-[11px] font-montserrat-semi text-textSecondary mb-2 text-center">
                            Pay with
                          </Text>
                          <View className="flex-row justify-center gap-2 mb-3">
                            {(['gcash', 'maya', 'card'] as const).map((m) => {
                              const selected = tipMethod === m;
                              return (
                                <Pressable
                                  key={m}
                                  onPress={() => {
                                    Haptics.selectionAsync().catch(() => {});
                                    setTipMethod(m);
                                  }}
                                  hitSlop={{ top: 4, bottom: 4 }}
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
                                  accessibilityLabel={`Pay tip with ${TIP_METHOD_LABEL[m]}`}
                                >
                                  <Text
                                    className={`text-xs font-montserrat-semi ${
                                      selected ? 'text-primary' : 'text-textSecondary'
                                    }`}
                                  >
                                    {TIP_METHOD_LABEL[m]}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                          <Button
                            title={`Pay ₱${tipAmount} tip`}
                            onPress={payGatewayTip}
                            loading={tipStatus === 'sending'}
                            loadingTitle="Starting…"
                            fullWidth
                          />
                          <Text className="text-[11px] font-montserrat text-textMuted mt-2 text-center">
                            Paid via {TIP_METHOD_LABEL[tipMethod]} — 100% goes to your runner.
                          </Text>
                        </>
                      )}
                    </View>
                  )}
                </>
              )}
            </View>
          )}
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
          <Illustration name="success-rated" size={168} style={{ marginBottom: 8 }} />
          <SuccessCheck
            size={72}
            celebrate
            // Once the check settles, reveal the optional next-steps and arm
            // a gentle auto-return. The timer still carries the user home on
            // its own — the steps are a choice, not a gate — but it runs long
            // enough (~6s) that tapping one is realistic.
            onDone={() => {
              setShowNextSteps(true);
              autoReturnTimer.current = setTimeout(finishAndGoHome, 6000);
            }}
          />
          <Text className="text-lg font-montserrat-bold text-textPrimary mt-5">
            Thanks for the feedback!
          </Text>

          {/* Re-engage at peak satisfaction — two honest next-steps.
              Rendered graceful: Book again only appears once we know the
              errand type; Invite always works. Both fall through to the
              auto-return if the user does nothing. */}
          {showNextSteps && (
            <View className="w-full px-8 mt-8 gap-3">
              {booking?.errand_type_id ? (
                <Button
                  title="Book again"
                  icon={Repeat}
                  onPress={handleBookAgain}
                  accessibilityHint="Start a new booking of the same errand type"
                  fullWidth
                />
              ) : null}
              <Button
                title="Invite a friend — you both earn credit"
                variant="secondary"
                icon={Gift}
                onPress={handleInvite}
                accessibilityHint="Share your referral code"
                fullWidth
              />
              <Pressable
                className="items-center py-2 mt-1"
                onPress={finishAndGoHome}
                accessibilityRole="button"
                accessibilityLabel="Not now, go home"
                hitSlop={8}
                style={({ pressed }) => pressFx(pressed)}
              >
                <Text className="text-sm font-montserrat text-textSecondary">
                  Not now
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {/* Gateway-tip verification — same honest verify/success/failure overlay
          as the top-up checkout. Only shown for an active 'tip' attempt; the
          runner is credited solely on a backend-confirmed success. */}
      <PaymentProgress
        stage={
          attempt?.kind === 'tip' && verifyStage && verifyStage !== 'preparing'
            ? verifyStage
            : null
        }
        offline={isOffline}
        successTitle="Tip sent!"
        successSubtitle="Thanks for tipping your runner."
        successCta="Done"
        receipt={
          attempt?.kind === 'tip'
            ? { amount: attempt.amount, method: attempt.method, paidAt: attempt.paidAt }
            : undefined
        }
        onSuccessDone={() => {
          resolveAttempt();
          setTipStatus('done');
          invalidateQuery(['wallet']);
        }}
        failureMessage={
          attempt?.failureReason ? mapFailureReason(attempt.failureReason).message : undefined
        }
        onClose={() => {
          resolveAttempt();
          setTipStatus('idle');
        }}
        onSafeExit={() => {
          resolveAttempt();
          setTipStatus('idle');
        }}
      />
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
