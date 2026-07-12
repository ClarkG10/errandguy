import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { XCircle } from 'lucide-react-native';
import { Spinner } from './Spinner';
import { SuccessCheck } from './SuccessCheck';
import { Button } from './Button';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';

/**
 * Staged payment-checkout feedback for the moments the APP controls around a
 * Xendit hosted-checkout hand-off (the sheet itself is Xendit's UI):
 *
 *   redirecting → Spinner "Opening secure checkout…"  (while the invoice/URL
 *                 is created and just before the sheet opens)
 *   verifying   → Spinner "Confirming your payment…"  (optional post-return beat)
 *   success     → SuccessCheck "Payment received"      (mirrors payment-complete.tsx)
 *   failed      → XCircle "Payment didn't go through"  (with Close / Try again)
 *
 * Renders as a centered card over a scrim. `stage = null` renders nothing.
 * Because the checkout sheet is a native window it floats ABOVE this overlay
 * while open; this frame is what the user sees before and after it.
 */
export type PaymentStage = 'redirecting' | 'verifying' | 'success' | 'failed';

interface PaymentProgressProps {
  stage: PaymentStage | null;
  /** Success headline. Default "Payment received". */
  successTitle?: string;
  /** Success subtitle. Default mirrors payment-complete.tsx. */
  successSubtitle?: string;
  /** Fired once the success check animation settles (~900ms). Navigate here. */
  onSuccessDone?: () => void;
  /** Failed-state primary action. */
  onRetry?: () => void;
  /** Failed-state dismiss. */
  onClose?: () => void;
}

export function PaymentProgress({
  stage,
  successTitle = 'Payment received',
  successSubtitle = "Your balance updates once it's confirmed.",
  onSuccessDone,
  onRetry,
  onClose,
}: PaymentProgressProps) {
  if (!stage) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          {stage === 'success' ? (
            <>
              <SuccessCheck size={64} onDone={onSuccessDone} />
              <Text style={styles.title}>{successTitle}</Text>
              <Text style={styles.sub}>{successSubtitle}</Text>
            </>
          ) : stage === 'failed' ? (
            <>
              <View style={styles.failDisc}>
                <XCircle size={34} color={LightColors.danger} strokeWidth={2} />
              </View>
              <Text style={styles.title}>Payment didn't go through</Text>
              <Text style={styles.sub}>You weren't charged. Try another method.</Text>
              <View style={styles.actions}>
                {onRetry ? (
                  <Button title="Try again" onPress={onRetry} fullWidth />
                ) : null}
                {onClose ? (
                  <Button
                    title="Close"
                    variant={onRetry ? 'ghost' : 'primary'}
                    onPress={onClose}
                    fullWidth
                  />
                ) : null}
              </View>
            </>
          ) : (
            <>
              <Spinner kind="brand" size="large" />
              <Text style={styles.title}>
                {stage === 'verifying' ? 'Confirming your payment…' : 'Opening secure checkout…'}
              </Text>
              <Text style={styles.sub}>
                {stage === 'verifying'
                  ? 'This only takes a moment.'
                  : 'You’ll be taken to a secure page to pay.'}
              </Text>
            </>
          )}
        </View>
      </View>
    </Modal>
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
  actions: {
    marginTop: 20,
    width: '100%',
    gap: 10,
  },
});
