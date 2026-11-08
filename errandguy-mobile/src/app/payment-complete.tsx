import { useCallback, useEffect, useState } from 'react';
import { View, Text, StatusBar, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { PaymentProgress } from '../components/ui/PaymentProgress';
import { useAuthStore } from '../stores/authStore';
import { usePaymentStore, type PaymentAttempt } from '../stores/paymentStore';
import { usePaymentVerification } from '../hooks/usePaymentVerification';
import { mapFailureReason } from '../utils/paymentErrors';
import { bookingPaymentFailure } from '../hooks/useCompleteBookingPayment';
import { LightColors } from '../constants/colors';
import { useBookingStore } from '../stores/bookingStore';
import { bookingService } from '../services/booking.service';
import type { Booking } from '../types';
import { useNotificationPermission } from '../hooks/useNotificationPermission';
import { formatCurrency } from '../utils/formatCurrency';
import { getErrandTypeRule } from '../constants/errandTypeRules';
import { BookingSuccess, type BookingSuccessRow } from '../components/customer/booking/BookingSuccess';
import { paymentMethodLabel } from '../components/customer/booking/paymentMethods';

/**
 * Landing route for the payment return deep link (errandguy://payment-complete).
 *
 * Reached on the system-browser fallback and on cold relaunch after checkout.
 * If there's an in-flight payment attempt, this screen VERIFIES it against the
 * backend (never assumes success) and shows the honest outcome — confirmed
 * receipt, actionable failure, or "being processed, we'll notify you". With no
 * tracked attempt it stays honest-neutral and bounces the user home; the
 * webhook remains the source of truth for balances.
 */
export default function PaymentComplete() {
  const router = useRouter();
  const role = useAuthStore((s) => s.role);
  const isHydrated = usePaymentStore((s) => s.isHydrated);
  const resolve = usePaymentStore((s) => s.resolve);
  const { attempt, stage, isOffline } = usePaymentVerification();
  // The booking this payment was for (the create response the review screen
  // stored), for the success screen's pickup/drop-off read-back.
  const activeBooking = useBookingStore((s) => s.activeBooking);
  const bookingPaid = attempt?.kind === 'booking' && stage === 'success';
  const pushPermission = useNotificationPermission(bookingPaid);
  // A cold relaunch from checkout has no booking in the store: read it once
  // (best-effort) so the success screen can show where the errand goes.
  const [fetchedBooking, setFetchedBooking] = useState<Booking | null>(null);
  const paidBookingId = bookingPaid ? attempt?.bookingId : undefined;
  const storeHasIt = !!paidBookingId && activeBooking?.id === paidBookingId;
  useEffect(() => {
    if (!paidBookingId || storeHasIt) return;
    let cancelled = false;
    bookingService
      .getBooking(paidBookingId)
      .then((res) => {
        const fresh = res?.data?.data;
        if (!cancelled && fresh?.id === paidBookingId) setFetchedBooking(fresh);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [paidBookingId, storeHasIt]);

  const goHome = useCallback(() => {
    if (role === 'runner') router.replace('/(runner)/(tabs)');
    else router.replace('/(customer)/(tabs)');
  }, [role, router]);

  // Only auto-redirect when there's NOTHING to verify. An active attempt must
  // stay on screen until it reaches a terminal/pending outcome.
  useEffect(() => {
    if (!isHydrated || attempt) return;
    const t = setTimeout(goHome, 1200);
    return () => clearTimeout(t);
  }, [isHydrated, attempt, goHome]);

  const routeAfterSuccess = useCallback(
    (a: PaymentAttempt) => {
      resolve();
      if (a.kind === 'booking' && a.bookingId) router.replace(`/(customer)/tracking/${a.bookingId}`);
      else if (a.kind === 'payout') router.replace('/(runner)/payout');
      else goHome();
    },
    [resolve, router, goHome],
  );

  const routeToOrigin = useCallback(
    (a: PaymentAttempt) => {
      resolve();
      if (a.kind === 'payout') router.replace('/(runner)/payout');
      else goHome();
    },
    [resolve, router, goHome],
  );

  // Neutral, honest fallback: nothing to verify (or not hydrated yet).
  if (!isHydrated || !attempt) {
    return <FinishingUp goHome={goHome} />;
  }

  // A booking charge the server ruled on has its own outcomes — refunded
  // after the errand was cancelled, or declined/expired and the errand
  // cancelled — told with the same copy the in-app overlay uses. Anything
  // else (and tips) keeps the general mapping: this screen has no "Resume
  // payment" for the copy that would point at one.
  const bookingFailure =
    attempt.status === 'failed' && attempt.kind === 'booking'
      ? bookingPaymentFailure(attempt.failureReason)
      : null;
  const failure =
    attempt.status !== 'failed'
      ? null
      : bookingFailure?.recovery === 'rebook'
        ? bookingFailure
        : mapFailureReason(attempt.failureReason);

  // A booking payment the server CONFIRMED: the full success screen — the
  // errand is booked and paid, here's what happens next. (Every other outcome,
  // and tips/payouts, keep the PaymentProgress card below.)
  if (bookingPaid) {
    const booking =
      activeBooking?.id === attempt.bookingId
        ? activeBooking
        : fetchedBooking?.id === attempt.bookingId
          ? fetchedBooking
          : null;
    const rule = getErrandTypeRule(booking?.errand_type?.slug);
    const method = paymentMethodLabel(attempt.method);
    const scheduledAtMs = booking?.scheduled_at ? Date.parse(booking.scheduled_at) : NaN;
    const scheduledLater =
      booking?.schedule_type === 'scheduled' && Number.isFinite(scheduledAtMs) && scheduledAtMs > Date.now();
    const rows: BookingSuccessRow[] = [
      ...(booking?.pickup_address ? [{ label: rule.pickupLabel, value: booking.pickup_address }] : []),
      ...(booking?.dropoff_address && !rule.singleLocation
        ? [{ label: rule.dropoffLabel, value: booking.dropoff_address }]
        : []),
    ];
    return (
      <View style={{ flex: 1, backgroundColor: LightColors.surface }}>
        <StatusBar barStyle="dark-content" />
        <BookingSuccess
          title="Errand booked"
          announcement="Payment confirmed. Errand booked."
          facts={[
            attempt.reference,
            // "paid" only because the server confirmed this payment.
            method ? `${formatCurrency(attempt.amount)} paid by ${method}` : formatCurrency(attempt.amount),
          ]}
          rows={rows}
          next={
            <View>
              <Text style={styles.nextTitle}>What happens next</Text>
              <Text style={styles.nextBody}>
                {/* Until the errand is loaded we can't tell a scheduled one
                    from an immediate one — say only what's true of both. */}
                {!booking
                  ? 'Your errand is paid. Track it to see when a runner accepts.'
                  : scheduledLater
                  ? 'We’ll match you with a runner shortly before your scheduled time.'
                  : pushPermission === 'granted'
                    ? 'We’re finding you a runner — you’ll get a notification when one accepts.'
                    : 'We’re finding you a runner. Track your errand to see the moment one accepts.'}
              </Text>
            </View>
          }
          primary={{ title: 'Track errand', onPress: () => routeAfterSuccess(attempt) }}
          secondary={{
            title: 'Back to home',
            onPress: () => {
              resolve();
              goHome();
            },
          }}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: LightColors.background }}>
      <StatusBar barStyle="dark-content" />
      <PaymentProgress
        stage={stage}
        offline={isOffline}
        successTitle="Payment confirmed"
        successCta={attempt.kind === 'booking' ? 'Back to your errand' : 'Done'}
        receipt={{
          amount: attempt.amount,
          method: attempt.method,
          reference: attempt.reference,
          paidAt: attempt.paidAt,
        }}
        onSuccessDone={() => routeAfterSuccess(attempt)}
        failureTitle={failure?.title}
        failureMessage={failure?.message}
        onChooseAnotherMethod={() => routeToOrigin(attempt)}
        onClose={() => {
          resolve();
          goHome();
        }}
        onSafeExit={() => {
          resolve();
          goHome();
        }}
      />
    </View>
  );
}

function FinishingUp({ goHome }: { goHome: () => void }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: LightColors.background,
        padding: 24,
      }}
    >
      <StatusBar barStyle="dark-content" />
      <Spinner kind="brand" size={12} color={LightColors.primary} />
      <Text
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
        style={{
          marginTop: 20,
          fontFamily: 'Quicksand_700Bold',
          fontSize: 16,
          color: LightColors.textPrimary,
        }}
      >
        Finishing up…
      </Text>
      <Text
        style={{
          marginTop: 4,
          fontFamily: 'Quicksand_500Medium',
          fontSize: 13,
          lineHeight: 20,
          color: LightColors.textSecondary,
          textAlign: 'center',
        }}
      >
        Returning you to ErrandGuy — your payment shows up as soon as it’s confirmed.
      </Text>
      <View
        style={{ marginTop: 32, width: '100%', maxWidth: 360, alignSelf: 'center', paddingHorizontal: 8 }}
      >
        <Button title="Continue" onPress={goHome} fullWidth />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nextTitle: {
    fontFamily: 'Quicksand_700Bold',
    fontSize: 15,
    color: LightColors.textPrimary,
  },
  nextBody: {
    marginTop: 2,
    fontFamily: 'Quicksand_500Medium',
    fontSize: 13,
    lineHeight: 19,
    color: LightColors.textSecondary,
  },
});
