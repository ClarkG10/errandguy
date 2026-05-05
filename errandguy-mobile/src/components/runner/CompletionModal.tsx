import React, { useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { MotiView } from 'moti';
import { Image } from 'expo-image';
import { X, Eraser, CheckCircle2 } from 'lucide-react-native';
import { Button } from '../ui/Button';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';

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
      // backend stores it in Supabase and writes `signature_url` on
      // the booking, and the customer tracking screen reads it back.
      const uri = await padRef.current?.exportToFile();
      await onComplete(uri ?? '');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="absolute inset-0 bg-black/60 justify-end z-50">
      <MotiView
        from={{ translateY: 60, opacity: 0 }}
        animate={{ translateY: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 22, stiffness: 220, mass: 0.8 }}
        className="bg-background px-7 pt-7 pb-12"
        style={{ maxHeight: '85%' }}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-lg font-montserrat-bold text-textPrimary">
            {title}
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <X size={24} color="#64748B" />
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
              className="w-full h-32 rounded-xl"
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
              height={180}
              onBegin={() => setSigned(true)}
            />
            <Text className="text-[11px] font-montserrat text-textTertiary mt-1.5 mb-3">
              Hand the phone to the customer to sign with their finger.
            </Text>

            {signed && (
              <Pressable
                onPress={handleClear}
                className="flex-row items-center justify-center gap-2 mb-4"
              >
                <Eraser size={14} color="#64748B" />
                <Text className="text-xs font-montserrat text-textSecondary">
                  Clear Signature
                </Text>
              </Pressable>
            )}

            <Button
              title={submitting ? 'Submitting…' : 'Confirm & Complete'}
              onPress={handleSubmit}
              disabled={!signed || submitting}
              fullWidth
            />
          </>
        ) : (
          <>
            {/* Confirm-only flow: no customer present to sign. */}
            <View className="bg-primaryLight rounded-xl p-4 mb-4 flex-row items-start gap-3">
              <CheckCircle2 size={20} color="#2563EB" />
              <Text className="flex-1 text-sm font-montserrat text-textPrimary leading-5">
                {subtitle ??
                  'Tap confirm to mark this errand as completed. The customer will be notified immediately.'}
              </Text>
            </View>

            <Button
              title={submitting ? 'Submitting…' : 'Confirm Completion'}
              onPress={handleSubmit}
              disabled={submitting}
              fullWidth
            />
          </>
        )}
      </MotiView>
    </View>
  );
}

