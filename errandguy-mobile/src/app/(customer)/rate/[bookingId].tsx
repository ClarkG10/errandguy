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
import { CheckCircle, Repeat, Check } from 'lucide-react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useBookingStore } from '../../../stores/bookingStore';
import { bookingService } from '../../../services/booking.service';
import { queueable } from '../../../services/mutationQueue';
import { runOptimistic } from '../../../utils/optimistic';
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
import { PaymentProgress } from '../../../components/ui/PaymentProgress';
import {
  usePaymentStore,
  isAttemptActive,
  shouldRetainIdempotencyKey,
} from '../../../stores/paymentStore';
import { usePaymentVerification } from '../../../hooks/usePaymentVerification';
import { useWalletSummary } from '../../../hooks/useWalletSummary';
import { newIdempotencyKey } from '../../../utils/idempotency';
import { openCheckoutUrl, PAYMENT_RETURN_URL } from '../../../utils/browser';
import { mapFailureReason } from '../../../utils/paymentErrors';
import { invalidateQuery } from '../../../hooks/useQuery';
import { formatCurrency } from '../../../utils/formatCurrency';
import { fareLines } from '../../../utils/fareLines';
import { repeatDraft } from '../../../utils/repeatDraft';

// A tip is paid from the wallet (when its withdrawable balance covers it) or
// with a one-time GCash / Maya checkout — so a zero-wallet / cash-errand
// customer can still tip. 100% goes to the runner either way.
type TipMethod = 'wallet' | 'gcash' | 'maya';
const TIP_METHOD_LABEL: Record<TipMethod, string> = {
  wallet: 'Wallet',
  gcash: 'GCash',
  maya: 'Maya',
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
  const updateDraft = useBookingStore((s) => s.updateDraft);
  const setStep = useBookingStore((s) => s.setStep);

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
  // null = not chosen yet, so the default follows the wallet balance once it
  // loads (wallet when it covers the tip, GCash otherwise).
  const [chosenTipMethod, setChosenTipMethod] = useState<TipMethod | null>(null);
  // Set when a wallet tip is refused for insufficient balance — the wallet is
  // then off the table for this screen.
  const [walletRefused, setWalletRefused] = useState(false);
  const tipLatch = useRef(false);
  // The GCash/Maya tip's Idempotency-Key, held across a failure whose outcome
  // is unknown (timeout / offline / 5xx / 409) so the retry REPLAYS the first
  // charge instead of opening a second one. Tied to the (amount, method) it was
  // sent with: the server hashes the body, so a changed tip gets a fresh key.
  const tipKeyRef = useRef<{ key: string; sig: string } | null>(null);

  // Gateway-tip verification infra (shared with booking checkout).
  const beginAttempt = usePaymentStore((s) => s.beginAttempt);
  const setAttemptStatus = usePaymentStore((s) => s.setStatus);
  const resolveAttempt = usePaymentStore((s) => s.resolve);
  const { attempt, stage: verifyStage, isOffline } = usePaymentVerification();
  // Post-submit celebration overlay — shown briefly (SuccessCheck fires
  // its own success haptic), then we navigate home from onDone.
  const [showSuccess, setShowSuccess] = useState(false);
  // Once the check animation settles we reveal a calm, optional next step
  // (Book again) under the celebration. It never blocks the auto-return — a
  // pending timer still carries the user home; tapping it (or "Not now") just
  // pre-empts and clears it.
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

  // Book the same errand again — the whole errand, onto a pre-filled Review,
  // exactly like Home's "Repeat last" (one shared builder, repeatDraft). It
  // used to preselect only the type, so the customer re-entered every address
  // and item. Without the route to rebuild (no pickup coordinates) it falls
  // back to the type picker with the type chosen. Replace, not push: the rate
  // screen is done, so it shouldn't linger in the back stack behind the
  // funnel.
  const handleBookAgain = useCallback(() => {
    cancelAutoReturn();
    haptics.light();
    clearDraft();
    setActiveBooking(null);
    const draft = booking ? repeatDraft(booking) : null;
    if (draft) {
      updateDraft(draft);
      setStep(3);
      router.replace('/(customer)/book/review');
      return;
    }
    router.replace(
      booking?.errand_type_id
        ? {
            pathname: '/(customer)/book/type',
            params: { preselected: booking.errand_type_id },
          }
        : '/(customer)/book/type',
    );
  }, [cancelAutoReturn, clearDraft, setActiveBooking, updateDraft, setStep, router, booking]);

  const handleSubmit = useCallback(async () => {
    // In-flight guard (defense-in-depth beyond the Button's disabled state): a
    // same-frame double-tap can fire two onPress calls before the re-render
    // commits, and reviewBooking is a plain non-idempotent POST.
    if (!bookingId || rating === 0 || isSubmitting) return;
    setIsSubmitting(true);
    // Declared once so an online submit and an offline replay are the SAME
    // call. A review is CONTENT, never money — the tip above is a separate
    // action and is never queued. Replay is safe because a second submit is a
    // server-side no-op (422 "You have already reviewed this booking"), which
    // the handler resolves as success; the queue drops any other 4xx outright.
    //
    // dedupeKey is per booking: a re-rate before the queue drains replaces the
    // pending entry, so only the last thing the customer chose is ever sent.
    const q = queueable(
      'booking.review',
      { bookingId, rating, comment: comment.trim() || undefined },
      {
        invalidate: [['bookings'], ['booking', bookingId]],
        dedupeKey: `review-${bookingId}`,
      },
    );
    // No local state to flip — the celebration IS the applied state, and it
    // runs from onSuccess so a queued-while-offline review celebrates exactly
    // like a committed one (the offline toast says when it'll actually post).
    // Nothing to undo, so rollback is a no-op.
    await runOptimistic({
      apply: () => {},
      rollback: () => {},
      ...q,
      onSuccess: () => {
        // The overlay is purely visual — announce the outcome so screen
        // readers get a confirmation before the route swaps home.
        AccessibilityInfo.announceForAccessibility(
          'Review submitted. Thanks for the feedback!'
        );
        // Brief celebratory beat before leaving — SuccessCheck handles the
        // success haptic and calls onDone once the animation settles.
        setShowSuccess(true);
      },
      onError: () => haptics.error(),
      errorMessage: copy.booking.rateFailed,
      offlineMessage: "Saved — we'll post your review when you're back online.",
    });
    setIsSubmitting(false);
  }, [bookingId, rating, comment, isSubmitting]);

  const handleSkip = useCallback(() => {
    finishAndGoHome();
  }, [finishAndGoHome]);

  const runnerFirstName = booking?.runner?.full_name?.split(' ')[0];
  // Tips come from the WITHDRAWABLE balance only — bonus credit never pays
  // for one. The wallet is offered only when we KNOW it covers the tip.
  const walletQ = useWalletSummary();
  const withdrawable = walletQ.data?.withdrawable ?? null;
  const walletCoversTip =
    !walletRefused && withdrawable != null && tipAmount > 0 && withdrawable >= tipAmount;
  const tipMethods: TipMethod[] = walletCoversTip ? ['wallet', 'gcash', 'maya'] : ['gcash', 'maya'];
  const tipMethod: TipMethod =
    chosenTipMethod && tipMethods.includes(chosenTipMethod)
      ? chosenTipMethod
      : walletCoversTip
        ? 'wallet'
        : 'gcash';

  // Instant, wallet-funded tip. On an insufficient-balance rejection, fall
  // back to GCash / Maya instead of failing the whole action.
  const sendWalletTip = useCallback(async () => {
    if (!bookingId || tipAmount <= 0 || tipLatch.current) return;
    tipLatch.current = true;
    setTipStatus('sending');
    try {
      await bookingService.tip(bookingId, tipAmount);
      setTipStatus('done');
      invalidateQuery(['wallet']);
      haptics.success();
      toast.success('Tip sent — thank you!');
    } catch (err: any) {
      setTipStatus('idle');
      if (err?.code === 'INSUFFICIENT_WALLET_BALANCE') {
        setWalletRefused(true);
        invalidateQuery(['wallet']);
        toast.info('Not enough wallet balance — pay the tip with GCash or Maya.');
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

  // GCash / Maya tip — paid directly with a one-time checkout (no wallet
  // needed): create the charge, open it, VERIFY the outcome.
  const payGatewayTip = useCallback(async (method: 'gcash' | 'maya') => {
    if (!bookingId || tipAmount <= 0) return;
    if (isAttemptActive(usePaymentStore.getState().attempt)) {
      toast.info("We're still confirming your last payment — hang tight.");
      return;
    }
    if (tipLatch.current) return;
    tipLatch.current = true;
    const sig = `${tipAmount}|${method}`;
    if (!tipKeyRef.current || tipKeyRef.current.sig !== sig) {
      tipKeyRef.current = { key: newIdempotencyKey(), sig };
    }
    const payAttempt = beginAttempt({
      kind: 'tip',
      amount: tipAmount,
      method,
      bookingId,
      idempotencyKey: tipKeyRef.current.key,
    });
    setTipStatus('sending');
    try {
      const res = await bookingService.tipCheckout(bookingId, tipAmount, method, {
        idempotencyKey: payAttempt.idempotencyKey,
      });
      // The server answered (a replay included): this key is spent.
      tipKeyRef.current = null;
      const checkoutUrl: string | undefined = res.data?.checkout_url;
      const txId: string | undefined = res.data?.data?.id;
      if (!checkoutUrl) {
        resolveAttempt();
        setTipStatus('idle');
        toast.error('Could not start the tip payment. Please try again.');
        return;
      }
      setAttemptStatus('awaiting_gateway', { transactionId: txId, checkoutUrl });
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
      // Release the one-payment lock, but keep the key when the outcome is
      // unknown so the next tap replays this charge rather than adding one.
      resolveAttempt();
      if (!shouldRetainIdempotencyKey(err)) tipKeyRef.current = null;
      setTipStatus('idle');
      haptics.error();
      toast.error(errorMessage(err, 'Could not start the tip payment. You weren’t charged.'));
    } finally {
      tipLatch.current = false;
    }
  }, [bookingId, tipAmount, beginAttempt, setAttemptStatus, resolveAttempt]);

  const sendTip = () => {
    if (tipMethod === 'wallet') void sendWalletTip();
    else void payGatewayTip(tipMethod);
  };

  // Shared pressed-state for the tag chips and Skip — same recipe as the
  // tracking chrome: scale + opacity, opacity only under Reduce Motion.
  const pressFx = (pressed: boolean) =>
    pressed
      ? reduceMotion
        ? { opacity: 0.7 }
        : { opacity: 0.85, transform: [{ scale: 0.97 }] }
      : null;

  const priceItems = fareLines(booking, booking?.promo_discount);

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

          {/* Optional tip — from the wallet when its balance covers it, or a
              one-time GCash / Maya checkout so a zero-wallet / cash-errand
              customer can still tip. 100% goes to the runner either way. */}
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
                      <Text className="text-[11px] font-montserrat-semi text-textSecondary mb-2 text-center">
                        Pay with
                      </Text>
                      <View className="flex-row justify-center gap-2 mb-3">
                        {tipMethods.map((m) => {
                          const selected = tipMethod === m;
                          return (
                            <Pressable
                              key={m}
                              onPress={() => {
                                Haptics.selectionAsync().catch(() => {});
                                setChosenTipMethod(m);
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
                        title={
                          tipMethod === 'wallet'
                            ? `Send ₱${tipAmount} tip`
                            : `Pay ₱${tipAmount} tip`
                        }
                        onPress={sendTip}
                        loading={tipStatus === 'sending'}
                        loadingTitle={tipMethod === 'wallet' ? 'Sending…' : 'Starting…'}
                        fullWidth
                      />
                      <Text className="text-[11px] font-montserrat text-textMuted mt-2 text-center">
                        {tipMethod === 'wallet' && withdrawable != null
                          ? `Paid from your wallet (${formatCurrency(withdrawable)})`
                          : `Paid via ${TIP_METHOD_LABEL[tipMethod]}`}{' '}
                        — 100% goes to your runner.
                      </Text>
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

          {/* Re-engage at peak satisfaction — Book again only appears once
              we know the errand type, and everything falls through to the
              auto-return if the user does nothing. */}
          {showNextSteps && (
            <View className="w-full px-8 mt-8 gap-3">
              {booking?.errand_type_id ? (
                <Button
                  title="Book again"
                  icon={Repeat}
                  onPress={handleBookAgain}
                  accessibilityHint="Starts a new booking pre-filled from this one"
                  fullWidth
                />
              ) : null}
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

      {/* GCash/Maya tip verification — the same honest verify/success/failure
          overlay as the booking checkout. Only shown for an active 'tip'
          attempt; the runner is credited solely on a backend-confirmed
          success. */}
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
        failureTitle={
          attempt?.failureReason ? mapFailureReason(attempt.failureReason).title : undefined
        }
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
