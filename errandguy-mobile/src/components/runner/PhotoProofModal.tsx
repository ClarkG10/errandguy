import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, Linking } from 'react-native';
import { Image } from 'expo-image';
import { MotiView } from 'moti';
import { Camera, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Button } from '../ui/Button';
import { useImagePicker, type ImagePickerSource } from '../../hooks/useImagePicker';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';
import { toast } from '../../stores/toastStore';

interface PhotoProofModalProps {
  type: 'pickup' | 'delivery';
  onConfirm: (uri: string) => void;
  onClose: () => void;
}

export function PhotoProofModal({ type, onConfirm, onClose }: PhotoProofModalProps) {
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Surface a denied camera/photo permission with a Settings deep-link so
  // the runner isn't stuck at a dead capture button in a proof-required flow.
  const handlePermissionDenied = useCallback((source: ImagePickerSource) => {
    toast.error(
      source === 'camera'
        ? 'Camera access is off — enable it in Settings'
        : 'Photo access is off — enable it in Settings',
      { actionLabel: 'Settings', onAction: () => Linking.openSettings().catch(() => {}) },
    );
  }, []);
  const { pickImage, takePhoto } = useImagePicker({ onPermissionDenied: handlePermissionDenied });

  const handleCapture = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const result = await takePhoto();
    if (result) setPhotoUri(result.uri);
  };

  const handleGallery = async () => {
    const result = await pickImage();
    if (result) setPhotoUri(result.uri);
  };

  const handleConfirm = async () => {
    if (!photoUri || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(photoUri);
    } finally {
      setSubmitting(false);
    }
  };

  // Guard a backdrop tap once a photo is captured so a stray tap can't
  // silently discard the proof. The X button stays the explicit close.
  const handleBackdropPress = () => {
    if (submitting) return;
    if (photoUri) {
      toast.warning('Discard this photo?', { actionLabel: 'Discard', onAction: onClose });
      return;
    }
    onClose();
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
        style={s.backdrop}
        onPress={handleBackdropPress}
        accessibilityViewIsModal
      >
        <Pressable onPress={(e) => e.stopPropagation()}>
          <MotiView
            from={{ translateY: 400, opacity: 0 }}
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
              <Text style={s.title}>
                {type === 'pickup' ? 'Pickup Photo' : 'Delivery Photo'}
              </Text>
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

            <Text style={s.subtitle}>
              {type === 'pickup'
                ? 'Take a photo of the item you picked up.'
                : 'Take a photo as proof of delivery.'}
            </Text>

            {!photoUri ? (
              <View style={{ gap: 12 }}>
                <Pressable
                  onPress={handleCapture}
                  accessibilityRole="button"
                  accessibilityLabel="Take photo"
                  style={s.captureArea}
                >
                  <Camera size={40} color={LightColors.primary} />
                  <Text style={s.captureLabel}>Take Photo</Text>
                </Pressable>
                {/* Delivery proof is camera-only: a hand-off photo must be
                    captured live at the drop-off, so the gallery picker (which
                    would let a stale/screenshot image stand in) is hidden.
                    Pickup proof keeps the gallery option. */}
                {type !== 'delivery' && (
                  <Button
                    title="Choose from Gallery"
                    variant="outline"
                    onPress={handleGallery}
                    fullWidth
                  />
                )}
              </View>
            ) : (
              <View>
                <Image
                  source={{ uri: photoUri }}
                  style={{ width: '100%', height: 192, borderRadius: 12, marginBottom: 16 }}
                  contentFit="cover"
                />
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Retake"
                      variant="outline"
                      onPress={() => setPhotoUri(null)}
                      disabled={submitting}
                      fullWidth
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Confirm"
                      onPress={handleConfirm}
                      loading={submitting}
                      loadingTitle="Uploading…"
                      fullWidth
                    />
                  </View>
                </View>
              </View>
            )}
          </MotiView>
        </Pressable>
      </Pressable>
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
    marginBottom: 8,
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
  subtitle: {
    fontSize: 13,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textSecondary,
    marginBottom: 20,
  },
  captureArea: {
    height: 192,
    backgroundColor: LightColors.surfaceMuted,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    // textMuted, not divider: the near-white divider (#ECEFF3) on the muted
    // fill measured ~1.05:1 — the capture boundary was effectively invisible
    // outdoors. #94A3B8 clears the 3:1 non-text-component floor so the proof
    // target reads as a tappable dropzone in sunlight.
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
