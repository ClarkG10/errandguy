import React, { useEffect, useRef } from 'react';
import { Modal, View, Text, StyleSheet, AccessibilityInfo } from 'react-native';
import { XCircle, Clock, WifiOff } from 'lucide-react-native';
import { Spinner } from './Spinner';
import { SuccessCheck } from './SuccessCheck';
import { Button } from './Button';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';
import { CHROME_MAX_FONT_SCALE, BODY_MAX_FONT_SCALE } from '../../constants/fontScale';
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

/**
 * What a screen reader hears when the overlay changes stage.
 *
 * This modal covers the whole screen for 10–60s on the money path and used to
 * say nothing at all — a blind customer tapped "Confirm & pay", lost the
 * screen, and could not tell whether they had been charged.
 *
 * Deliberately NOT announced: `preparing` and `redirecting`. Those two flip
 * sub-second on a warm connection, and iOS's announcement queue would either
 * stack them or cut the meaningful one short. The first thing spoken is
 * therefore the first stage the user actually waits inside.
 */
const STAGE_ANNOUNCEMENTS: Partial<Record<PaymentStage, string>> = {
  verifying: 'Verifying your payment. Please wait.',
  pending: 'Payment is being processed. You can safely leave this screen.',
  success: 'Payment confirmed.',
  failed: "Payment didn't go through. You weren't charged.",
};

const OFFLINE_STAGE_ANNOUNCEMENTS: Partial<Record<PaymentStage, string>> = {
  verifying: "Checking payment status. We'll continue once you're back online.",
  pending: "Checking payment status. We'll update you once you're back online.",
};

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
  // The one sentence this stage is worth saying out loud — '' for the two
  // sub-second stages we deliberately stay quiet through. Success speaks the
  // caller's own title ("Tip sent", "Top-up confirmed") rather than the
  // generic line, since that is what the user is waiting to hear.
  const liveMessage = !stage
    ? ''
    : stage === 'success'
      ? (successTitle ? `${successTitle}.` : STAGE_ANNOUNCEMENTS.success!)
      : ((offline ? OFFLINE_STAGE_ANNOUNCEMENTS[stage] : undefined) ??
        STAGE_ANNOUNCEMENTS[stage] ??
        '');

  // Announce each meaningful stage change. Hooks must run unconditionally, so
  // this sits ABOVE the `!stage` early return.
  const spokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!liveMessage) {
      // Reset once the overlay is dismissed so a second attempt speaks again.
      if (!stage) spokenRef.current = null;
      return;
    }
    // Key on the sentence, not the stage: an offline→online flip inside
    // `verifying` changes the message and is worth re-speaking, while a plain
    // re-render with the same stage is not.
    if (spokenRef.current === liveMessage) return;
    spokenRef.current = liveMessage;
    // Announced on BOTH platforms, not iOS-only, even though the live region
    // below covers Android: this is the money path, and the live region sits
    // on an opacity-0 node inside a Modal, which TalkBack is not guaranteed to
    // pick up. A rare doubled sentence is a much better failure than a
    // customer who cannot tell whether they were charged. Same belt-and-braces
    // pairing as book/confirm.tsx.
    AccessibilityInfo.announceForAccessibility(liveMessage);
  }, [stage, liveMessage]);

  if (!stage) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.scrim}>
        {/* Android live region — mirrors the iOS-friendly announce above so
            both platforms hear the stage without focus being yanked. Visually
            hidden; the visible copy below is the same information. */}
        <Text
          accessibilityLiveRegion="polite"
          importantForAccessibility="yes"
          style={styles.srOnly}
        >
          {liveMessage}
        </Text>
        <View
          style={styles.card}
          // The card is the modal's content root. `accessibilityViewIsModal`
          // keeps VoiceOver inside it instead of letting a swipe wander onto
          // the screen behind the scrim, which the user cannot act on anyway.
          accessibilityViewIsModal
          accessibilityRole="alert"
        >
          {stage === 'success' ? (
            <>
              <SuccessCheck size={64} />
              <Text
                style={styles.title}
                accessibilityRole="header"
                maxFontSizeMultiplier={BODY_MAX_FONT_SCALE}
              >
                {successTitle}
              </Text>
              {successSubtitle ? (
                <Text style={styles.sub} maxFontSizeMultiplier={BODY_MAX_FONT_SCALE}>
                  {successSubtitle}
                </Text>
              ) : null}
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
              <Text
                style={styles.title}
                accessibilityRole="header"
                maxFontSizeMultiplier={BODY_MAX_FONT_SCALE}
              >
                Payment didn't go through
              </Text>
              <Text style={styles.sub} maxFontSizeMultiplier={BODY_MAX_FONT_SCALE}>
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
              <Text
                style={styles.title}
                accessibilityRole="header"
                maxFontSizeMultiplier={BODY_MAX_FONT_SCALE}
              >
                {offline ? 'Checking payment status' : 'Payment is being processed'}
              </Text>
              <Text style={styles.sub} maxFontSizeMultiplier={BODY_MAX_FONT_SCALE}>
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
              <Text
                style={styles.title}
                accessibilityRole="header"
                maxFontSizeMultiplier={BODY_MAX_FONT_SCALE}
              >
                {titleForStage(stage, offline)}
              </Text>
              <Text style={styles.sub} maxFontSizeMultiplier={BODY_MAX_FONT_SCALE}>
                {subForStage(stage, offline)}
              </Text>
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

/**
 * One label/value pair. `accessible` collapses the two Texts into a single
 * screen-reader stop so the receipt reads "Amount, ₱250.00" instead of four
 * orphaned labels followed by four orphaned values in an unrelated order.
 *
 * The row is `flexDirection: 'row'` with the label and value side by side, so
 * both halves are capped at CHROME_MAX_FONT_SCALE — uncapped they collide and
 * the reference truncates to nothing.
 */
function ReceiptRow({
  label,
  value,
  strong,
  truncate,
}: {
  label: string;
  value: string;
  strong?: boolean;
  truncate?: boolean;
}) {
  return (
    <View style={styles.receiptRow} accessible accessibilityLabel={`${label}, ${value}`}>
      <Text style={styles.receiptLabel} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
        {label}
      </Text>
      <Text
        style={strong ? styles.receiptValueStrong : styles.receiptValue}
        numberOfLines={truncate ? 1 : undefined}
        maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
      >
        {value}
      </Text>
    </View>
  );
}

function ReceiptRows({ receipt }: { receipt: PaymentReceipt }) {
  const method = formatMethod(receipt.method);
  const when = formatDateTime(receipt.paidAt);
  return (
    <View style={styles.receipt}>
      <ReceiptRow label="Amount" value={formatCurrency(receipt.amount)} strong />
      {method ? <ReceiptRow label="Method" value={method} /> : null}
      {receipt.reference ? (
        <ReceiptRow label="Reference" value={receipt.reference} truncate />
      ) : null}
      {when ? <ReceiptRow label="Date" value={when} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Visually hidden, still in the accessibility tree — carries the Android
  // polite live region for the stage copy.
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },
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
