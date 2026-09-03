import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { MotiView } from 'moti';
import { X, Camera, Receipt as ReceiptIcon, MessageCircle, AlertTriangle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useImagePicker, type ImagePickerSource } from '../../hooks/useImagePicker';
import { formatCurrency } from '../../utils/formatCurrency';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';
import { toast } from '../../stores/toastStore';

interface ReceiptCaptureModalProps {
  visible: boolean;
  budget: number;
  submitting?: boolean;
  onSubmit: (params: { actualCost: number; receiptUri: string }) => void | Promise<void>;
  onClose: () => void;
  /**
   * Open the booking chat. Offered as the FIRST exit from an over-budget
   * basket, because talking to the customer about what to drop or swap is the
   * only thing that can actually resolve one (see the over-budget panel).
   * Optional so the modal still renders standalone.
   */
  onMessageCustomer?: () => void;
  /** Open the mid-errand issue sheet — the escalation when the customer can't
   *  be reached and the runner is stuck at the till. */
  onReportIssue?: () => void;
}

export function ReceiptCaptureModal({
  visible,
  budget,
  submitting = false,
  onSubmit,
  onClose,
  onMessageCustomer,
  onReportIssue,
}: ReceiptCaptureModalProps) {
  const [amountText, setAmountText] = useState('');
  const [receiptUri, setReceiptUri] = useState<string | null>(null);

  // Turn a silent permission denial into a recovery path: a toast that
  // deep-links to the OS Settings so the runner isn't stuck with a
  // dead capture button in a proof-required flow.
  const handlePermissionDenied = useCallback((source: ImagePickerSource) => {
    toast.error(
      source === 'camera'
        ? 'Camera access is off — enable it in Settings'
        : 'Photo access is off — enable it in Settings',
      { actionLabel: 'Settings', onAction: () => Linking.openSettings().catch(() => {}) },
    );
  }, []);
  const { pickImage, takePhoto } = useImagePicker({ onPermissionDenied: handlePermissionDenied });

  const amount = useMemo(() => {
    const n = Number(amountText.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }, [amountText]);

  const overBudget = amount > budget;
  const canSubmit = amount > 0 && !overBudget && !!receiptUri && !submitting;

  const handleCapture = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const r = await takePhoto();
    if (r) setReceiptUri(r.uri);
  };
  const handleGallery = async () => {
    const r = await pickImage();
    if (r) setReceiptUri(r.uri);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !receiptUri) return;
    await onSubmit({ actualCost: amount, receiptUri });
  };

  // Guard a backdrop tap once the runner has entered an amount or captured
  // a receipt — a stray tap must not silently discard proof. The X button
  // stays the explicit, unguarded close.
  const hasUnsavedInput = amountText.trim().length > 0 || !!receiptUri;
  const handleBackdropPress = () => {
    if (submitting) return;
    if (hasUnsavedInput) {
      toast.warning('Discard receipt details?', {
        actionLabel: 'Discard',
        onAction: onClose,
      });
      return;
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={submitting ? undefined : onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          style={s.backdrop}
          onPress={handleBackdropPress}
          accessibilityViewIsModal
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <MotiView
              from={{ translateY: 500, opacity: 0 }}
              animate={{ translateY: 0, opacity: 1 }}
              transition={{ type: 'spring', damping: 22, stiffness: 220, mass: 0.8 }}
              style={s.sheet}
            >
            {/* Handle */}
            <View style={s.handleWrap}>
              <View style={s.handle} />
            </View>

            {/* Header */}
            <View style={s.header}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ReceiptIcon size={22} color={LightColors.primary} />
                <Text style={s.title}>Receipt &amp; Actual Cost</Text>
              </View>
              <Pressable
                onPress={onClose}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
                style={s.closeBtn}
              >
                <X size={18} color={LightColors.textTertiary} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Budget banner */}
              <View style={s.budgetBanner}>
                <Text style={s.budgetLabel}>Customer pre-authorized budget</Text>
                <Text style={s.budgetAmount}>{formatCurrency(budget)}</Text>
                <Text style={s.budgetHint}>
                  You cannot charge more than this. If items cost less, only the actual
                  amount will be charged to the customer.
                </Text>
              </View>

              <Input
                label="Actual amount paid (₱) *"
                value={amountText}
                onChangeText={setAmountText}
                placeholder="0.00"
                keyboardType="decimal-pad"
                // Route the over-budget state through Input's own error slot:
                // it renders the message in dangerDark (AA at 12px) and turns
                // the field border red — one signal, correct contrast, no
                // separate low-contrast Text.
                error={
                  overBudget
                    ? `Over budget by ${formatCurrency(amount - budget)}`
                    : undefined
                }
              />

              {/* Over-budget dead-end, made honest.
                  The old copy read "message the customer to add funds" — but
                  `shopping_budget` has exactly ONE writer in the whole API
                  (booking creation), so there is no screen, no endpoint and no
                  path by which a customer can add funds. A runner standing at
                  the till followed that instruction into nothing.
                  What the app CAN do is: talk to the customer about the
                  basket, or hand the problem to support. Both are one tap from
                  here now, and the amount + receipt survive the trip (this
                  modal stays mounted), so the runner comes back to the numbers
                  they already entered. */}
              {overBudget && (
                <View style={s.overBudgetPanel}>
                  <Text style={s.overBudgetTitle}>
                    The budget can&apos;t be raised in the app
                  </Text>
                  <Text style={s.overBudgetBody}>
                    We can only charge the customer up to{' '}
                    {formatCurrency(budget)} for items. Agree with them on what
                    to drop or swap, then enter the new total. If you&apos;re
                    stuck at the till, report it and support will take it from
                    there.
                  </Text>
                  {(onMessageCustomer || onReportIssue) && (
                    <View style={s.overBudgetActions}>
                      {onMessageCustomer && (
                        <Pressable
                          onPress={onMessageCustomer}
                          accessibilityRole="button"
                          accessibilityLabel="Message the customer about the basket"
                          hitSlop={6}
                          style={[s.overBudgetBtn, s.overBudgetBtnPrimary]}
                        >
                          <MessageCircle
                            size={15}
                            color={LightColors.textInverse}
                            strokeWidth={2.2}
                          />
                          <Text style={s.overBudgetBtnPrimaryLabel}>
                            Message customer
                          </Text>
                        </Pressable>
                      )}
                      {onReportIssue && (
                        <Pressable
                          onPress={onReportIssue}
                          accessibilityRole="button"
                          accessibilityLabel="Report this to support"
                          hitSlop={6}
                          style={s.overBudgetBtn}
                        >
                          <AlertTriangle
                            size={15}
                            color={LightColors.textPrimary}
                            strokeWidth={2.2}
                          />
                          <Text style={s.overBudgetBtnLabel}>Report</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              )}

              <Text style={s.sectionLabel}>Receipt photo *</Text>

              {!receiptUri ? (
                <View style={{ gap: 12, marginBottom: 16 }}>
                  <Pressable
                    onPress={handleCapture}
                    accessibilityRole="button"
                    accessibilityLabel="Take photo of receipt"
                    style={s.captureArea}
                  >
                    <Camera size={36} color={LightColors.primary} />
                    <Text style={s.captureLabel}>Take photo of receipt</Text>
                  </Pressable>
                  <Button
                    title="Choose from Gallery"
                    variant="outline"
                    onPress={handleGallery}
                    fullWidth
                  />
                </View>
              ) : (
                <View style={{ marginBottom: 16 }}>
                  <Image
                    source={{ uri: receiptUri }}
                    style={{ width: '100%', height: 192, borderRadius: 12 }}
                    contentFit="cover"
                  />
                  <Pressable
                    onPress={() => setReceiptUri(null)}
                    style={{ marginTop: 8, paddingVertical: 8, alignItems: 'center' }}
                    accessibilityRole="button"
                    accessibilityLabel="Replace photo"
                    hitSlop={10}
                  >
                    <Text style={{ fontSize: 12, fontFamily: 'Quicksand_500Medium', color: LightColors.primary }}>
                      Replace photo
                    </Text>
                  </Pressable>
                </View>
              )}

              <Button
                // Verb-led and sentence case, like every other runner action —
                // this was the last Title-Case status label in the runner flow.
                title="Submit & confirm pickup"
                onPress={handleSubmit}
                disabled={!canSubmit}
                loading={submitting}
                loadingTitle="Uploading…"
                fullWidth
              />
            </ScrollView>
            </MotiView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: LightColors.surface,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 48,
    maxHeight: '92%' as any,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
  },
  handleWrap: {
    alignItems: 'center',
    paddingBottom: 16,
  },
  handle: {
    width: 40,
    height: 6,
    borderRadius: 3,
    backgroundColor: LightColors.divider,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textPrimary,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: LightColors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  budgetBanner: {
    backgroundColor: LightColors.primaryLight,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  budgetLabel: {
    fontSize: 12,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textSecondary,
  },
  budgetAmount: {
    fontSize: 20,
    // Inter tabular figures — matches the money foundation used on the
    // payout screen and cockpit payout strip (Quicksand digits aren't
    // tabular and drift on a trust-critical figure).
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: LightColors.primary,
    marginTop: 2,
  },
  budgetHint: {
    // 12px floor (was 11) and textSecondary, not textTertiary: #64748B on the
    // primaryLight wash measures ~4.38:1 — under the 4.5:1 AA floor for <17px.
    // #475569 clears it (~7:1) for the budget cap the runner must not misread.
    fontSize: 12,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textSecondary,
    marginTop: 4,
  },
  overBudgetPanel: {
    backgroundColor: LightColors.dangerSoft,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  overBudgetTitle: {
    fontSize: 13,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.dangerDark,
  },
  overBudgetBody: {
    // 12px floor on a soft wash, textSecondary for AA — same rule the budget
    // hint above follows.
    fontSize: 12,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textSecondary,
    marginTop: 4,
    lineHeight: 17,
  },
  overBudgetActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  overBudgetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: LightColors.dividerStrong,
    backgroundColor: LightColors.surface,
  },
  overBudgetBtnPrimary: {
    flex: 1,
    borderColor: LightColors.primary,
    backgroundColor: LightColors.primary,
  },
  overBudgetBtnLabel: {
    fontSize: 13,
    fontFamily: 'Quicksand_600SemiBold',
    color: LightColors.textPrimary,
    marginLeft: 6,
  },
  overBudgetBtnPrimaryLabel: {
    fontSize: 13,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textInverse,
    marginLeft: 6,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textSecondary,
    marginBottom: 8,
    marginTop: 4,
  },
  captureArea: {
    height: 160,
    backgroundColor: LightColors.surfaceMuted,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    // See PhotoProofModal — divider on the muted fill was invisible outdoors;
    // textMuted clears the 3:1 non-text-component floor.
    borderColor: LightColors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureLabel: {
    fontSize: 14,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textSecondary,
    marginTop: 8,
  },
});
