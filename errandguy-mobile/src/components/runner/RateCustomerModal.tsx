import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  ScrollView,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { MotiView } from 'moti';
import { Avatar } from '../ui/Avatar';
import { RatingStars } from '../ui/RatingStars';
import { Button } from '../ui/Button';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';

interface RateCustomerModalProps {
  customerName: string;
  customerAvatar?: string | null;
  onSubmit: (rating: number, comment: string) => void;
  onSkip: () => void;
}

export function RateCustomerModal({
  customerName,
  customerAvatar,
  onSubmit,
  onSkip,
}: RateCustomerModalProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit(rating, comment);
    } finally {
      setSubmitting(false);
    }
  };

  // Real RN Modal so the OS resizes the window when the keyboard pops up,
  // wrapped in KeyboardAvoidingView + a tap-outside-to-dismiss layer so
  // the comment field never gets buried by the keyboard on small screens.
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onSkip} statusBarTranslucent>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View
            className="flex-1 bg-black/60 justify-center items-center px-6"
            accessibilityViewIsModal
          >
            <ScrollView
              className="w-full"
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <MotiView
                from={{ opacity: 0, scale: 0.94, translateY: 16 }}
                animate={{ opacity: 1, scale: 1, translateY: 0 }}
                transition={{ type: 'spring', damping: 22, stiffness: 240, mass: 0.7 }}
                style={{
                  backgroundColor: LightColors.surface,
                  // Radius.modal (20) — matches ConfirmModal, the app's
                  // centered-dialog reference (was a one-off 24).
                  borderRadius: Radius.modal,
                  padding: 28,
                  width: '100%',
                  maxWidth: 400,
                }}
              >
                <View className="items-center mb-4">
                  <Avatar uri={customerAvatar} name={customerName} size="xl" />
                  <Text className="text-base font-montserrat-bold text-textPrimary mt-2">
                    Rate {customerName}
                  </Text>
                  <Text className="text-xs font-montserrat text-textSecondary">
                    How was your experience?
                  </Text>
                </View>

                <View className="items-center mb-4">
                  <RatingStars value={rating} onChange={setRating} size={36} />
                  {/* Explain why Submit is disabled — a disabled CTA with no
                      stated reason reads as broken. */}
                  {rating === 0 && (
                    <Text className="text-xs font-montserrat text-textTertiary mt-2">
                      Tap a star to submit
                    </Text>
                  )}
                </View>

                {/* Character counter — the comment caps at 200 chars. */}
                <Text className="text-xs font-montserrat text-textTertiary text-right mb-1">
                  {comment.length}/200
                </Text>

                <TextInput
                  style={{
                    backgroundColor: LightColors.background,
                    borderWidth: 1,
                    borderColor: LightColors.divider,
                    borderRadius: 12,
                    padding: 12,
                    fontSize: 14,
                    fontFamily: 'Quicksand_400Regular',
                    color: LightColors.textPrimary,
                    minHeight: 80,
                    marginBottom: 20,
                  }}
                  placeholder="Leave a comment (optional)"
                  placeholderTextColor={LightColors.textMuted}
                  multiline
                  maxLength={200}
                  value={comment}
                  onChangeText={setComment}
                  textAlignVertical="top"
                  returnKeyType="done"
                  blurOnSubmit
                />

                <View style={{ gap: 10 }}>
                  <Button
                    title="Submit"
                    onPress={handleSubmit}
                    disabled={rating === 0 || submitting}
                    loading={submitting}
                    loadingTitle="Submitting…"
                    fullWidth
                  />
                  <Pressable
                    onPress={onSkip}
                    style={{ alignItems: 'center', paddingVertical: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel="Skip rating"
                    hitSlop={8}
                  >
                    <Text style={{ fontSize: 14, fontFamily: 'Quicksand_400Regular', color: LightColors.textSecondary }}>
                      Skip
                    </Text>
                  </Pressable>
                </View>
              </MotiView>
            </ScrollView>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}
