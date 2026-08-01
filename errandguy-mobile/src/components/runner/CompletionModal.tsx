import React, { useRef, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { Image } from 'expo-image';
import { X, Eraser, CheckCircle2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Button } from '../ui/Button';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { LightColors } from '../../constants/colors';
import { useResponsive } from '../../constants/responsive';
import { toast } from '../../stores/toastStore';

interface CompletionModalProps {
  bookingId: string;
  deliveryPhotoUrl?: string | null;
  /**
   * When false, the customer is not present at completion (single-location
   * tasks like queue / bills payment, or transportation drop-offs where the
   * passenger has already disembarked). Show a simple confirm-only dialog
   * instead of a signature pad.
   */
  requiresSignature?: boolean;
  /** Title shown in the modal header. Lets each errand type tell the runner what they're completing. */
  title?: string;
  /** Short helper text under the title for non-signature flows. */
  subtitle?: string;
  /** Resolved with a file:// URI when a signature is captured, or an
   *  empty string for confirm-only flows. The parent uploads the file
   *  via the existing multipart helper. */
  onComplete: (signatureUri: string) => void | Promise<void>;
  onClose: () => void;
}

export function CompletionModal({
  bookingId,
  deliveryPhotoUrl,
  requiresSignature = true,
  title = 'Complete Errand',
  subtitle,
  onComplete,
  onClose,
}: CompletionModalProps) {
  const [signed, setSigned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
      onRequestClose={submitting ? undefined : onClose}
    >
      <Pressable
        className="flex-1 bg-black/60 justify-end"
        onPress={submitting ? undefined : onClose}
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
                onPress={onClose}
                disabled={submitting}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close completion form"
                className="w-9 h-9 rounded-full bg-surfaceMuted items-center justify-center"
              >
                <X size={18} color={LightColors.textTertiary} />
              </Pressable>
            </View>

            {/* Delivery Photo Preview */}
            {deliveryPhotoUrl && (
              <View className="mb-4">
                <Text className="text-xs font-montserrat-bold text-textSecondary mb-2">
                  {requiresSignature ? 'Delivery Photo' : 'Proof Photo'}
                </Text>
                <Image
                  source={{ uri: deliveryPhotoUrl }}
                  className="w-full h-28 rounded-lg"
                  contentFit="cover"
                />
              </View>
            )}

            {requiresSignature ? (
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
    </Modal>
  );
}

