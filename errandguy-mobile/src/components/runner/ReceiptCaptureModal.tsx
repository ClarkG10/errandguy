import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, Modal, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { MotiView } from 'moti';
import { X, Camera, Receipt as ReceiptIcon } from 'lucide-react-native';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useImagePicker } from '../../hooks/useImagePicker';
import { formatCurrency } from '../../utils/formatCurrency';

interface ReceiptCaptureModalProps {
  visible: boolean;
  /** Pre-authorized maximum the runner can charge. */
  budget: number;
  /** Submit returns control to caller; loading state is owned by caller. */
  submitting?: boolean;
  onSubmit: (params: { actualCost: number; receiptUri: string }) => void | Promise<void>;
  onClose: () => void;
}

export function ReceiptCaptureModal({
  visible,
  budget,
  submitting = false,
  onSubmit,
  onClose,
}: ReceiptCaptureModalProps) {
  const [amountText, setAmountText] = useState('');
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const { pickImage, takePhoto } = useImagePicker();

  const amount = useMemo(() => {
    const n = Number(amountText.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }, [amountText]);

  const overBudget = amount > budget;
  const canSubmit = amount > 0 && !overBudget && !!receiptUri && !submitting;

  const handleCapture = async () => {
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={submitting ? undefined : onClose}
    >
      <Pressable
        className="flex-1 bg-black/60 justify-end"
        onPress={submitting ? undefined : onClose}
      >
        <Pressable onPress={(e) => e.stopPropagation()}>
          <MotiView
            from={{ translateY: 500, opacity: 0 }}
            animate={{ translateY: 0, opacity: 1 }}
            transition={{ type: 'spring', damping: 22, stiffness: 220, mass: 0.8 }}
            className="bg-background rounded-t-3xl px-6 pt-4 pb-10"
            style={{ maxHeight: '92%' }}
          >
            <View className="items-center pb-3">
              <View className="w-10 h-1.5 rounded-full bg-divider" />
            </View>

            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-2">
                <ReceiptIcon size={22} color="#2563EB" />
                <Text className="text-lg font-montserrat-bold text-textPrimary">
                  Receipt &amp; Actual Cost
                </Text>
              </View>
              <Pressable onPress={onClose} disabled={submitting}>
                <X size={24} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View className="bg-primaryLight rounded-xl px-4 py-3 mb-4">
                <Text className="text-xs font-montserrat text-textSecondary">
                  Customer pre-authorized budget
                </Text>
                <Text className="text-xl font-montserrat-bold text-primary mt-0.5">
                  {formatCurrency(budget)}
                </Text>
                <Text className="text-[11px] font-montserrat text-textTertiary mt-1">
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
              />
              {overBudget && (
                <Text className="text-xs font-montserrat text-danger -mt-2 mb-3">
                  Amount exceeds the budget. Contact the customer through chat to add more money.
                </Text>
              )}

              <Text className="text-xs font-montserrat-bold text-textSecondary mb-2 mt-1">
                Receipt photo *
              </Text>
              {!receiptUri ? (
                <View className="gap-3 mb-4">
                  <Pressable
                    onPress={handleCapture}
                    className="h-40 bg-gray-100 rounded-xl items-center justify-center border-2 border-dashed border-divider"
                  >
                    <Camera size={36} color="#94A3B8" />
                    <Text className="text-sm font-montserrat text-textSecondary mt-2">
                      Take photo of receipt
                    </Text>
                  </Pressable>
                  <Button
                    title="Choose from Gallery"
                    variant="outline"
                    onPress={handleGallery}
                    fullWidth
                  />
                </View>
              ) : (
                <View className="mb-4">
                  <Image
                    source={{ uri: receiptUri }}
                    className="w-full h-48 rounded-xl"
                    contentFit="cover"
                  />
                  <Pressable onPress={() => setReceiptUri(null)} className="mt-2">
                    <Text className="text-xs font-montserrat-semi text-primary text-center">
                      Replace photo
                    </Text>
                  </Pressable>
                </View>
              )}

              <Button
                title="Submit & Mark Picked Up"
                onPress={handleSubmit}
                disabled={!canSubmit}
                loading={submitting}
                fullWidth
              />
            </ScrollView>
          </MotiView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
