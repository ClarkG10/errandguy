import React, { useRef, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { Image } from 'expo-image';
import { X, Eraser, CheckCircle2, Banknote, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Input } from '../ui/Input';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { LightColors } from '../../constants/colors';
import { useResponsive } from '../../constants/responsive';
import { toast } from '../../stores/toastStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { mediaSource } from '../../utils/mediaSource';

/**
 * Why a handover is finished without a signature. Keys are the server's
 * (UpdateErrandStatusRequest::NO_SIGNATURE_REASONS); it refuses anything else,
 * and refuses all of them unless a delivery photo is already on the errand.
 */
export const NO_SIGNATURE_REASONS = [
  { key: 'recipient_unavailable', label: 'Recipient not available' },
  { key: 'left_with_guard', label: 'Left with guard or reception' },
  { key: 'customer_asked', label: 'Customer asked me to leave it' },
  { key: 'other', label: 'Other' },
] as const;

export type NoSignatureReason = (typeof NO_SIGNATURE_REASONS)[number]['key'];

export interface NoSignatureDetail {
  reason: NoSignatureReason;
  /** Required for 'other', optional otherwise. */
  note?: string;
}

interface CompletionModalProps {
  bookingId: string;
  deliveryPhotoUrl?: string | null;
  /**
   * When false, the customer is not present at completion (single-location
   * tasks like a queue job). Show a simple confirm-only dialog instead of a
   * signature pad.
   */
  requiresSignature?: boolean;
  /** Title shown in the modal header. Lets each errand type tell the runner what they're completing. */
  title?: string;
  /** Short helper text under the title for non-signature flows. */
  subtitle?: string;
  /**
   * Cash the runner takes at the door (the server's amount_to_collect). The
   * cockpit's "Collect ₱X" strip sits under this sheet, so the sheet repeats
   * it: the signature is exactly when the money changes hands.
   */
  collectAmount?: number | null;
  /**
   * A delivery photo is on file, so the runner may finish without a
   * signature by giving a reason (nobody home, left with the guard…).
   */
  canSkipSignature?: boolean;
  /** Resolved with a file:// URI when a signature is captured, or an
   *  empty string for confirm-only flows (and for a no-signature finish, which
   *  also passes its reason). The parent uploads the file via the existing
   *  multipart helper. */
  onComplete: (signatureUri: string, noSignature?: NoSignatureDetail) => void | Promise<void>;
  onClose: () => void;
}

export function CompletionModal({
  bookingId,
  deliveryPhotoUrl,
  requiresSignature = true,
  title = 'Complete Errand',
  subtitle,
  collectAmount,
  canSkipSignature = false,
  onComplete,
  onClose,
}: CompletionModalProps) {
  const [signed, setSigned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // "Can't get a signature?" — swaps the pad for a reason picker.
  const [skipSignature, setSkipSignature] = useState(false);
  const [reason, setReason] = useState<NoSignatureReason | null>(null);
  const [reasonNote, setReasonNote] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const padRef = useRef<SignaturePadHandle>(null);
  // On SE-height (667) and small-Android (640) devices the modal, delivery
  // thumbnail, 180pt pad and CTA together overrun the 92% cap at large font
  // scales — clipping "Confirm & Complete" off-screen. Shrink the pad on
  // short viewports so the primary action stays fully tappable.
  const { height } = useResponsive();
  const padHeight = height < 700 ? 150 : 180;
  const insets = useSafeAreaInsets();

  const handleClear = () => {
    padRef.current?.clear();
    setSigned(false);
  };

  // A stray backdrop tap used to throw away a signature the customer had just
  // drawn — with the customer already walking back inside. Anything the
  // runner has started here is confirmed before it is dropped.
  const inProgress = signed || reason != null || reasonNote.trim() !== '';
  const requestClose = () => {
    if (submitting) return;
    if (inProgress) {
      setConfirmLeave(true);
      return;
    }
    onClose();
  };

  const noteRequired = reason === 'other';
  const canFinishWithoutSignature =
    reason != null && (!noteRequired || reasonNote.trim() !== '');

  const handleSubmitWithoutSignature = async () => {
    if (submitting || !reason || !canFinishWithoutSignature) return;
    setSubmitting(true);
    try {
      // The note box only shows for "Other": text typed there and then hidden
      // by switching reason must not ride along under a different reason.
      const note = noteRequired ? reasonNote.trim() : '';
      await onComplete('', { reason, ...(note ? { note } : {}) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (!requiresSignature) {
        await onComplete('');
        return;
      }
      // Rasterise the SVG strokes → PNG file in the cache dir, then
      // hand the local file URI to the parent. The runner.service
      // upload helper attaches it as the `signature` form field, the
      // backend persists it to storage and writes `signature_url` on
      // the booking, and the customer tracking screen reads it back.
      const uri = await padRef.current?.exportToFile();
      // A signature-required completion must NEVER submit empty proof —
      // exportToFile returns null for a blank pad (a stray tap can no
      // longer arm the CTA, but export stays the hard gate). Abort and
      // keep the modal open so the runner actually captures the signature.
      if (!uri) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        toast.error('Please capture the customer signature');
        return;
      }
      await onComplete(uri);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={submitting ? undefined : requestClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <Pressable
        className="flex-1 bg-black/60 justify-end"
        onPress={submitting ? undefined : requestClose}
        accessibilityViewIsModal
      >
        {/* Inner stop-propagation layer so taps inside the sheet don't
            fall through to the dismiss backdrop. */}
        <Pressable onPress={(e) => e.stopPropagation()}>
          <MotiView
            from={{ translateY: 60, opacity: 0 }}
            animate={{ translateY: 0, opacity: 1 }}
            transition={{ type: 'spring', damping: 22, stiffness: 220, mass: 0.8 }}
            className="bg-surface pt-3 rounded-t-3xl"
            style={{ maxHeight: '92%' }}
          >
            {/* Grabber — matches the photo/receipt proof sheets. Stays fixed
                above the scroll area. */}
            <View className="items-center pb-3">
              <View className="w-10 h-1.5 rounded-full bg-divider" />
            </View>

            {/* Everything else scrolls, so the "Confirm & Complete" CTA is
                always reachable — on short screens / large font the fixed
                column used to overrun the 92% cap and clip the button. */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                paddingHorizontal: 24,
                paddingBottom: insets.bottom + 24,
              }}
            >
            {/* Header */}
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-lg font-montserrat-bold text-textPrimary">
                {title}
              </Text>
              <Pressable
                onPress={requestClose}
                disabled={submitting}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close completion form"
                className="w-9 h-9 rounded-full bg-surfaceMuted items-center justify-center"
              >
                <X size={18} color={LightColors.textTertiary} />
              </Pressable>
            </View>

            {/* The money moment. Same figure and wording as the cockpit strip
                this sheet covers. */}
            {collectAmount != null && collectAmount > 0 ? (
              <View
                className="mb-4 flex-row items-center rounded-xl px-3 py-2.5 bg-accentSoft border border-accentStrong"
                accessible
                accessibilityLabel={`Collect ${formatCurrency(collectAmount)} in cash from the customer`}
              >
                <Banknote size={17} color={LightColors.accentDark} strokeWidth={2} />
                <Text className="flex-1 ml-2.5 text-[13px] font-montserrat-bold text-textPrimary">
                  Collect {formatCurrency(collectAmount)} in cash
                </Text>
              </View>
            ) : null}

            {/* Delivery Photo Preview */}
            {deliveryPhotoUrl && (
              <View className="mb-4">
                <Text className="text-xs font-montserrat-bold text-textSecondary mb-2">
                  {requiresSignature ? 'Delivery Photo' : 'Proof Photo'}
                </Text>
                <Image
                  source={mediaSource(deliveryPhotoUrl)}
                  className="w-full h-28 rounded-lg"
                  contentFit="cover"
                />
              </View>
            )}

            {requiresSignature && skipSignature ? (
              <>
                {/* No-signature finish. The delivery photo is the proof; the
                    reason is kept on the errand's status history, where the
                    customer can read it. */}
                <Text className="text-xs font-montserrat-bold text-textSecondary mb-2">
                  Why is there no signature?
                </Text>
                <View accessibilityRole="radiogroup" accessibilityLabel="Reason for no signature">
                  {NO_SIGNATURE_REASONS.map((opt) => {
                    const selected = reason === opt.key;
                    return (
                      <Pressable
                        key={opt.key}
                        onPress={() => {
                          Haptics.selectionAsync().catch(() => {});
                          setReason(opt.key);
                        }}
                        accessibilityRole="radio"
                        accessibilityLabel={opt.label}
                        accessibilityState={{ selected }}
                        className={`flex-row items-center rounded-xl border px-4 py-3 mb-2 ${
                          selected ? 'border-primary bg-primaryLight' : 'border-divider bg-surfaceMuted'
                        }`}
                      >
                        <Text
                          className={`flex-1 text-[13px] ${
                            selected
                              ? 'font-montserrat-bold text-primary'
                              : 'font-montserrat-semi text-textPrimary'
                          }`}
                        >
                          {opt.label}
                        </Text>
                        {selected ? <Check size={16} color={LightColors.primary} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
                {noteRequired ? (
                  <View className="mt-1 mb-1">
                    <Input
                      label="What happened?"
                      value={reasonNote}
                      onChangeText={setReasonNote}
                      placeholder="e.g. Left with the neighbour"
                      maxLength={200}
                      returnKeyType="done"
                    />
                  </View>
                ) : null}
                <Text className="text-xs font-montserrat text-textTertiary mt-1.5 mb-3">
                  Your delivery photo is the proof. The customer will see this reason.
                </Text>
                <Button
                  title="Complete without signature"
                  loading={submitting}
                  loadingTitle="Completing…"
                  onPress={handleSubmitWithoutSignature}
                  disabled={!canFinishWithoutSignature || submitting}
                  fullWidth
                />
                <Pressable
                  onPress={() => {
                    setSkipSignature(false);
                    setReason(null);
                    setReasonNote('');
                  }}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityLabel="Back to signature"
                  hitSlop={8}
                  className="items-center py-3 mt-1"
                >
                  <Text className="text-xs font-montserrat-bold text-primary underline">
                    Back to signature
                  </Text>
                </Pressable>
              </>
            ) : requiresSignature ? (
              <>
                {/* Signature Pad — real PanResponder + SVG canvas. The
                    placeholder "tap to sign" affordance was confusing
                    runners (and the previous build never actually shipped
                    a bitmap to the backend). The pad below captures real
                    strokes, exports a PNG on submit, and uploads it to
                    the bookings.signature_url column. */}
                <Text className="text-xs font-montserrat-bold text-textSecondary mb-2">
                  Customer Signature
                </Text>
                <SignaturePad
                  ref={padRef}
                  height={padHeight}
                  onStroke={() => setSigned(true)}
                />
                <Text className="text-xs font-montserrat text-textTertiary mt-1.5 mb-3">
                  Hand the phone to the customer to sign with their finger.
                </Text>

                {signed && (
                  <Pressable
                    onPress={handleClear}
                    accessibilityRole="button"
                    accessibilityLabel="Clear signature"
                    hitSlop={8}
                    className="flex-row items-center justify-center gap-2 mb-4"
                  >
                    <Eraser size={14} color={LightColors.textTertiary} />
                    <Text className="text-xs font-montserrat text-textSecondary">
                      Clear Signature
                    </Text>
                  </Pressable>
                )}

                <Button
                  title="Confirm & Complete"
                  loading={submitting}
                  loadingTitle="Completing…"
                  onPress={handleSubmit}
                  disabled={!signed || submitting}
                  fullWidth
                />
                {canSkipSignature ? (
                  <Pressable
                    onPress={() => {
                      // A half-drawn signature is moot once they switch.
                      handleClear();
                      setSkipSignature(true);
                    }}
                    disabled={submitting}
                    accessibilityRole="button"
                    accessibilityLabel="Can't get a signature?"
                    hitSlop={8}
                    className="items-center py-3 mt-1"
                  >
                    <Text className="text-xs font-montserrat-bold text-primary underline">
                      Can’t get a signature?
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <>
                {/* Confirm-only flow: no customer present to sign. */}
                <View className="bg-surfaceMuted rounded-lg p-4 mb-4 flex-row items-start gap-3">
                  <CheckCircle2 size={20} color={LightColors.primary} />
                  <Text className="flex-1 text-sm font-montserrat text-textPrimary leading-5">
                    {subtitle ??
                      'Tap confirm to mark this errand as completed. The customer will be notified immediately.'}
                  </Text>
                </View>

                <Button
                  title="Confirm Completion"
                  loading={submitting}
                  loadingTitle="Completing…"
                  onPress={handleSubmit}
                  disabled={submitting}
                  fullWidth
                />
              </>
            )}
            </ScrollView>
          </MotiView>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
      {/* Rendered inside this Modal so it stacks above the sheet on iOS. */}
      <ConfirmModal
        visible={confirmLeave}
        title="Leave without finishing?"
        message={
          signed
            ? 'The customer’s signature will be cleared. The errand stays open until you complete it.'
            : 'What you’ve entered will be cleared. The errand stays open until you complete it.'
        }
        confirmLabel="Leave"
        cancelLabel="Keep going"
        destructive
        onConfirm={() => {
          setConfirmLeave(false);
          onClose();
        }}
        onCancel={() => setConfirmLeave(false)}
      />
    </Modal>
  );
}

