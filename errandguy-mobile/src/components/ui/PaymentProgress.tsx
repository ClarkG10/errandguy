import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { XCircle, Clock, WifiOff } from 'lucide-react-native';
import { Spinner } from './Spinner';
import { SuccessCheck } from './SuccessCheck';
import { Button } from './Button';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';
import { formatCurrency } from '../../utils/formatCurrency';

/**
 * Honest, staged feedback for a payment the app is VERIFYING (never assuming).
 * Payments hand off to Xendit's hosted checkout, so we only ever show stages we
 * can actually observe — there is no fabricated "authorizing with your bank"
 * theatre:
 *
 *   preparing   → creating the booking/top-up on our server
 *   redirecting → opening the secure Xendit checkout
 *   verifying   → back from checkout, confirming with the backend (polling)
 *   pending     → still unconfirmed → "you can safely leave, we'll notify you"
 *   success     → backend CONFIRMED → honest receipt (amount/method/ref/time)
 *   failed      → backend confirmed failure → actionable recovery
 *
 * Offline during verify/pending never reads as failure — it says we'll keep
 * checking once the connection is back.
 */
export type PaymentStage =
  | 'preparing'
  | 'redirecting'
  | 'verifying'
  | 'pending'
  | 'success'
  | 'failed';

export interface PaymentReceipt {
  amount: number;
  method?: string | null;
  reference?: string | null;
  paidAt?: string | null;
}

interface PaymentProgressProps {
  stage: PaymentStage | null;
  /** Show the offline variant of the verify/pending copy. */
  offline?: boolean;
  successTitle?: string;
  successSubtitle?: string;
  /** Honest confirmation details rendered on the success stage. */
  receipt?: PaymentReceipt;
  /** Success primary action (e.g. "Return to booking"). */
  onSuccessDone?: () => void;
  successCta?: string;
  /** Failed-state: message + recovery actions. */
  failureMessage?: string;
  onRetry?: () => void;
  onChooseAnotherMethod?: () => void;
  /** Pending-state primary action — leave safely; verification continues. */
  onSafeExit?: () => void;
  /** Dismiss (failed/redirect). */
  onClose?: () => void;
}

const METHOD_LABELS: Record<string, string> = {
  gcash: 'GCash',
  maya: 'Maya',
  grabpay: 'GrabPay',
  card: 'Card',
  wallet: 'ErrandGuy Wallet',
  cash: 'Cash',
};

function formatMethod(method?: string | null): string | null {
  if (!method) return null;
  return METHOD_LABELS[method] ?? method;
}

function formatDateTime(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function PaymentProgress({
  stage,
  offline = false,
  successTitle = 'Payment confirmed',
  successSubtitle,
  receipt,
  onSuccessDone,
  successCta = 'Done',
  failureMessage,
  onRetry,
  onChooseAnotherMethod,
  onSafeExit,
  onClose,
}: PaymentProgressProps) {
  if (!stage) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          {stage === 'success' ? (
            <>
              <SuccessCheck size={64} />
              <Text style={styles.title}>{successTitle}</Text>
              {successSubtitle ? <Text style={styles.sub}>{successSubtitle}</Text> : null}
              {receipt ? <ReceiptRows receipt={receipt} /> : null}
              {onSuccessDone ? (
                <View style={styles.actions}>
                  <Button title={successCta} onPress={onSuccessDone} fullWidth />
                </View>
              ) : null}
            </>
          ) : stage === 'failed' ? (
            <>
              <View style={styles.failDisc}>
                <XCircle size={34} color={LightColors.danger} strokeWidth={2} />
              </View>
              <Text style={styles.title}>Payment didn't go through</Text>
              <Text style={styles.sub}>
                {failureMessage ??
                  "We couldn't confirm this payment. You weren't charged — try again or pick another method."}
              </Text>
              <View style={styles.actions}>
                {onRetry ? <Button title="Try again" onPress={onRetry} fullWidth /> : null}
                {onChooseAnotherMethod ? (
                  <Button
                    title="Choose another method"
                    variant={onRetry ? 'outline' : 'primary'}
                    onPress={onChooseAnotherMethod}
                    fullWidth
                  />
                ) : null}
                {onClose ? (
                  <Button
                    title="Close"
                    variant={onRetry || onChooseAnotherMethod ? 'ghost' : 'primary'}
                    onPress={onClose}
                    fullWidth
                  />
                ) : null}
              </View>
            </>
          ) : stage === 'pending' ? (
            <>
              <View style={styles.pendingDisc}>
                {offline ? (
                  <WifiOff size={30} color={LightColors.warningDark} strokeWidth={2} />
                ) : (
                  <Clock size={30} color={LightColors.warningDark} strokeWidth={2} />
                )}
              </View>
              <Text style={styles.title}>
                {offline ? 'Checking payment status' : 'Payment is being processed'}
              </Text>
              <Text style={styles.sub}>
                {offline
                  ? "We'll keep checking and update you once you're back online. You weren't asked to pay again."
                  : "You can safely leave this screen — we'll notify you the moment it's confirmed. No need to pay again."}
              </Text>
              {onSafeExit ? (
                <View style={styles.actions}>
                  <Button title="Got it" onPress={onSafeExit} fullWidth />
                </View>
              ) : null}
            </>
          ) : (
            <>
              <Spinner kind="brand" size="large" />
              <Text style={styles.title}>{titleForStage(stage, offline)}</Text>
              <Text style={styles.sub}>{subForStage(stage, offline)}</Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function titleForStage(stage: PaymentStage, offline: boolean): string {
  if (stage === 'verifying') return offline ? 'Checking payment status' : 'Verifying your payment…';
  if (stage === 'preparing') return 'Getting things ready…';
  return 'Opening secure checkout…';
}

function subForStage(stage: PaymentStage, offline: boolean): string {
  if (stage === 'verifying') {
    return offline
      ? "We'll continue the moment you're back online. You weren't charged twice."
      : 'Confirming with your provider — this only takes a moment.';
  }
  if (stage === 'preparing') return 'Setting up your secure payment.';
  return 'You’ll be taken to a secure page to pay.';
}

function ReceiptRows({ receipt }: { receipt: PaymentReceipt }) {
  const method = formatMethod(receipt.method);
  const when = formatDateTime(receipt.paidAt);
  return (
    <View style={styles.receipt}>
      <View style={styles.receiptRow}>
        <Text style={styles.receiptLabel}>Amount</Text>
        <Text style={styles.receiptValueStrong}>{formatCurrency(receipt.amount)}</Text>
      </View>
      {method ? (
        <View style={styles.receiptRow}>
          <Text style={styles.receiptLabel}>Method</Text>
          <Text style={styles.receiptValue}>{method}</Text>
        </View>
      ) : null}
      {receipt.reference ? (
        <View style={styles.receiptRow}>
          <Text style={styles.receiptLabel}>Reference</Text>
          <Text style={styles.receiptValue} numberOfLines={1}>
            {receipt.reference}
          </Text>
        </View>
      ) : null}
      {when ? (
        <View style={styles.receiptRow}>
          <Text style={styles.receiptLabel}>Date</Text>
          <Text style={styles.receiptValue}>{when}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: LightColors.surface,
    borderRadius: Radius.sheet,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  title: {
    marginTop: 16,
    fontFamily: 'Quicksand_700Bold',
    fontSize: 16,
    color: LightColors.textPrimary,
    textAlign: 'center',
  },
  sub: {
    marginTop: 6,
    fontFamily: 'Quicksand_500Medium',
    fontSize: 13,
    lineHeight: 19,
    color: LightColors.textSecondary,
    textAlign: 'center',
  },
  failDisc: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: LightColors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingDisc: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: LightColors.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    marginTop: 20,
    width: '100%',
    gap: 10,
  },
  receipt: {
    marginTop: 18,
    width: '100%',
    gap: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: LightColors.divider,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  receiptLabel: {
    fontFamily: 'Quicksand_500Medium',
    fontSize: 13,
    color: LightColors.textSecondary,
  },
  receiptValue: {
    fontFamily: 'Quicksand_600SemiBold',
    fontSize: 13,
    color: LightColors.textPrimary,
    flexShrink: 1,
    textAlign: 'right',
  },
  receiptValueStrong: {
    fontFamily: 'Quicksand_700Bold',
    fontSize: 17,
    color: LightColors.textPrimary,
  },
});
