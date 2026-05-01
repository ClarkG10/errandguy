import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { MotiView } from 'moti';
import { Image } from 'expo-image';
import { X, Eraser, CheckCircle2 } from 'lucide-react-native';
import { Button } from '../ui/Button';

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
  onComplete: (signatureUri: string) => void;
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

  // Signature pad placeholder — would use react-native-canvas or gesture handler
  const handleSign = () => {
    setSigned(true);
  };

  const handleClear = () => {
    setSigned(false);
  };

  const handleSubmit = () => {
    // In production, capture signature bitmap from canvas
    // For now, use a placeholder URI when signature is required, empty otherwise.
    onComplete(requiresSignature ? 'signature_placeholder' : '');
  };

  return (
    <View className="absolute inset-0 bg-black/60 justify-end z-50">
      <MotiView
        from={{ translateY: 60, opacity: 0 }}
        animate={{ translateY: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 22, stiffness: 220, mass: 0.8 }}
        className="bg-background rounded-t-2xl px-6 pt-6 pb-10"
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
            {/* Signature Pad */}
            <Text className="text-xs font-montserrat-bold text-textSecondary mb-2">
              Customer Signature
            </Text>
            <Pressable
              onPress={handleSign}
              className={`h-40 rounded-xl border-2 border-dashed items-center justify-center mb-3 ${
                signed ? 'border-primary bg-primaryLight' : 'border-divider bg-gray-50'
              }`}
            >
              {signed ? (
                <Text className="text-sm font-montserrat text-primary">
                  ✓ Signature captured
                </Text>
              ) : (
                <Text className="text-sm font-montserrat text-textSecondary">
                  Tap here for customer to sign
                </Text>
              )}
            </Pressable>

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
              title="Confirm & Complete"
              onPress={handleSubmit}
              disabled={!signed}
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
              title="Confirm Completion"
              onPress={handleSubmit}
              fullWidth
            />
          </>
        )}
      </MotiView>
    </View>
  );
}

