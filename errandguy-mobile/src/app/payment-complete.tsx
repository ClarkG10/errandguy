import { useCallback, useEffect } from 'react';
import { View, Text, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { PaymentProgress } from '../components/ui/PaymentProgress';
import { useAuthStore } from '../stores/authStore';
import { usePaymentStore, type PaymentAttempt } from '../stores/paymentStore';
import { usePaymentVerification } from '../hooks/usePaymentVerification';
import { mapFailureReason } from '../utils/paymentErrors';
import { LightColors } from '../constants/colors';

/**
 * Landing route for the payment return deep link (errandguy://payment-complete).
 *
 * Reached on the system-browser fallback and on cold relaunch after checkout.
 * If there's an in-flight payment attempt, this screen VERIFIES it against the
 * backend (never assumes success) and shows the honest outcome — confirmed
 * receipt, actionable failure, or "being processed, we'll notify you". With no
 * tracked attempt (e.g. an e-wallet linking return) it stays honest-neutral and
 * bounces the user home; the webhook remains the source of truth for balances.
 */
export default function PaymentComplete() {
  const router = useRouter();
  const role = useAuthStore((s) => s.role);
  const isHydrated = usePaymentStore((s) => s.isHydrated);
  const resolve = usePaymentStore((s) => s.resolve);
  const { attempt, stage, isOffline } = usePaymentVerification();

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
      else if (a.kind === 'topup') router.replace('/(customer)/wallet');
      else if (a.kind === 'payout') router.replace('/(runner)/payout');
      else goHome();
    },
    [resolve, router, goHome],
  );

  const routeToOrigin = useCallback(
    (a: PaymentAttempt) => {
      resolve();
      if (a.kind === 'topup') router.replace('/(customer)/wallet/top-up');
      else if (a.kind === 'payout') router.replace('/(runner)/payout');
      else goHome();
    },
    [resolve, router, goHome],
  );

  // Neutral, honest fallback: nothing to verify (or not hydrated yet).
  if (!isHydrated || !attempt) {
    return <FinishingUp goHome={goHome} />;
  }

  const failure = attempt.status === 'failed' ? mapFailureReason(attempt.failureReason) : null;

  return (
    <View style={{ flex: 1, backgroundColor: LightColors.background }}>
      <StatusBar barStyle="dark-content" />
      <PaymentProgress
        stage={stage}
        offline={isOffline}
        successTitle="Payment confirmed"
        successCta={
          attempt.kind === 'booking'
            ? 'Return to booking'
            : attempt.kind === 'topup'
              ? 'View wallet'
              : 'Done'
        }
        receipt={{
          amount: attempt.amount,
          method: attempt.method,
          reference: attempt.reference,
          paidAt: attempt.paidAt,
        }}
        onSuccessDone={() => routeAfterSuccess(attempt)}
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
        Returning you to ErrandGuy — your balance updates once payment is confirmed.
      </Text>
      <View
        style={{ marginTop: 32, width: '100%', maxWidth: 360, alignSelf: 'center', paddingHorizontal: 8 }}
      >
        <Button title="Continue" onPress={goHome} fullWidth />
      </View>
    </View>
  );
}
