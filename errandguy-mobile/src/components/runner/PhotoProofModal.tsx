import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, Linking } from 'react-native';
import { Image } from 'expo-image';
import { MotiView } from 'moti';
import { Camera, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Button } from '../ui/Button';
import { PermissionPrompt } from '../ui/PermissionSheet';
import { useImagePicker, type ImagePickerSource } from '../../hooks/useImagePicker';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';
import { toast } from '../../stores/toastStore';
import { useReducedMotion } from '../../hooks/useReducedMotion';

interface PhotoProofModalProps {
  type: 'pickup' | 'delivery';
  /**
   * A capture that was already taken and whose upload failed (persisted by
   * `utils/pendingProof`). The sheet then OPENS on that photo with "Retry
   * upload" — before this, a failed upload reopened an empty camera and the
   * runner had to re-shoot a doorstep they may have left. `null` = fresh
   * capture, the original behaviour.
   */
  initialUri?: string | null;
  onConfirm: (uri: string) => void;
  onClose: () => void;
}

export function PhotoProofModal({
  type,
  initialUri = null,
  onConfirm,
  onClose,
}: PhotoProofModalProps) {
  const [photoUri, setPhotoUri] = useState<string | null>(initialUri);
  const [submitting, setSubmitting] = useState(false);
  /** True while showing the un-uploaded capture we were handed, so the CTA can
   *  say "Retry upload" instead of implying this is a new photo. */
  const isRetry = !!initialUri && photoUri === initialUri;

  const reduceMotion = useReducedMotion();
  // Camera refused at the OS level. Shown IN the sheet, not only as a toast:
  // the runner is standing at a door with a proof-gated step, and a toast that
  // fades in five seconds leaves a dead capture button behind it.
  const [cameraDenied, setCameraDenied] = useState(false);

  // Surface a denied camera/photo permission with a Settings deep-link so
  // the runner isn't stuck at a dead capture button in a proof-required flow.
  const handlePermissionDenied = useCallback((source: ImagePickerSource) => {
    if (source === 'camera') {
      setCameraDenied(true);
      return;
    }
    toast.error('Photo access is off — enable it in Settings', {
      actionLabel: 'Settings',
      onAction: () => Linking.openSettings().catch(() => {}),
    });
  }, []);
  const { pickImage, takePhoto } = useImagePicker({ onPermissionDenied: handlePermissionDenied });

  const handleCapture = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const result = await takePhoto();
    if (result) {
      setCameraDenied(false);
      setPhotoUri(result.uri);
    }
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
            from={reduceMotion ? { opacity: 1 } : { translateY: 400, opacity: 0 }}
            animate={{ translateY: 0, opacity: 1 }}
            transition={
              reduceMotion
                ? { type: 'timing', duration: 0 }
                : { type: 'spring', damping: 22, stiffness: 220, mass: 0.8 }
            }
            style={s.sheet}
          >
            {/* Handle */}
            <View style={s.handleWrap}>
              <View style={s.handle} />
            </View>

            {/* Header */}
            <View style={s.header}>
              <Text style={s.title} accessibilityRole="header">
                {type === 'pickup' ? 'Pickup photo' : 'Delivery photo'}
              </Text>
              <Pressable
                onPress={onClose}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
                style={s.closeBtn}
              >
                <X size={20} color={LightColors.textSecondary} />
              </Pressable>
            </View>

            <Text style={s.subtitle}>
              {isRetry
                ? 'This photo didn’t finish uploading. Send it again — no need to re-shoot.'
                : type === 'pickup'
                  ? 'Take a photo of the item you picked up. The customer sees it as proof of pickup.'
                  : 'Take a photo at the drop-off. It’s the customer’s proof of delivery.'}
            </Text>

            {!photoUri ? (
              <View style={{ gap: 12 }}>
                {cameraDenied ? (
                  // Pattern 7: why the camera is needed, Allow in Settings, and
                  // the alternative. Delivery proof is camera-only by design,
                  // so its alternative is another try once access is back.
                  <PermissionPrompt
                    kind="camera"
                    reason={
                      type === 'delivery'
                        ? 'The delivery photo is the customer’s proof, so it has to be taken live at the door.'
                        : 'The pickup photo shows the customer what you collected.'
                    }
                    alternativeLabel={
                      type === 'delivery' ? 'Try the camera again' : 'Choose from gallery instead'
                    }
                    onAlternative={type === 'delivery' ? handleCapture : handleGallery}
                  />
                ) : (
                  <Pressable
                    onPress={handleCapture}
                    accessibilityRole="button"
                    accessibilityLabel="Take photo"
                    style={s.captureArea}
                  >
                    <Camera size={40} color={LightColors.primary} strokeWidth={1.8} />
                    <Text style={s.captureLabel}>Take photo</Text>
                  </Pressable>
                )}
                {/* Delivery proof is camera-only: a hand-off photo must be
                    captured live at the drop-off, so the gallery picker (which
                    would let a stale/screenshot image stand in) is hidden.
                    Pickup proof keeps the gallery option. */}
                {type !== 'delivery' && !cameraDenied && (
                  <Button
                    title="Choose from gallery"
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
                      title={isRetry ? 'Retry upload' : 'Confirm'}
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
    width: 44,
    height: 44,
    borderRadius: 22,
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
    fontSize: 15,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.primary,
    marginTop: 8,
  },
});
