import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  Image,
  useWindowDimensions,
  Linking,
} from 'react-native';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  Camera,
  ImageIcon,
  X,
  RotateCcw,
  Check,
  Upload,
} from 'lucide-react-native';
import { toast } from '../../stores/toastStore';
import { Spinner } from './Spinner';
import { LightColors } from '../../constants/colors';

// Permission denial must never be a silent no-op — once the OS
// permanently denies, the only recovery is the system Settings page,
// so the toast carries a direct route there.
function toastPermissionDenied(message: string) {
  toast.error(message, {
    actionLabel: 'Settings',
    onAction: () => {
      Linking.openSettings().catch(() => {});
    },
  });
}

// Preview size is computed inside the component now (was a module-level
// const) so rotating an iPad or resizing iOS split view re-flows the
// preview tile correctly. Cap at 320pt to avoid an enormous square on
// large screens.

interface ImagePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (uri: string) => void;
  title?: string;
  subtitle?: string;
  /** Show a loading spinner overlay after confirm (e.g. while uploading).
   *  NOTE: most callers close the picker on confirm and upload in the
   *  background, so this overlay rarely renders — show determinate upload
   *  progress at the on-screen destination (see EditProfileModal avatar /
   *  DocumentUploadCard), not here. */
  uploading?: boolean;
}

type Stage = 'pick' | 'preview';

export function ImagePickerModal({
  visible,
  onClose,
  onConfirm,
  title = 'Upload Photo',
  subtitle,
  uploading = false,
}: ImagePickerModalProps) {
  const [stage, setStage] = useState<Stage>('pick');
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Cap at 320 so the preview tile never bloats on a tablet or
  // landscape-oriented phone; floor at 220 so it stays usable on
  // narrow phones in a split-view shell.
  const PREVIEW_SIZE = Math.max(220, Math.min(320, SCREEN_WIDTH - 80));

  const reset = useCallback(() => {
    setStage('pick');
    setPreviewUri(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const handleCamera = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      toastPermissionDenied('Camera access is needed to take photos');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setPreviewUri(result.assets[0].uri);
      setStage('preview');
    }
  }, []);

  const handleGallery = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      toastPermissionDenied('Photo library access is needed to choose a photo');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setPreviewUri(result.assets[0].uri);
      setStage('preview');
    }
  }, []);

  const handleConfirm = useCallback(() => {
    if (!previewUri) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onConfirm(previewUri);
    reset();
  }, [previewUri, onConfirm, reset]);

  const handleRetake = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setPreviewUri(null);
    setStage('pick');
  }, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: `${LightColors.ink}73` }}
        onPress={handleClose}
      >
        <Pressable onPress={(e) => e.stopPropagation()}>
          <MotiView
            from={{ translateY: 400, opacity: 0 }}
            animate={{ translateY: 0, opacity: 1 }}
            exit={{ translateY: 400, opacity: 0 }}
            transition={{ type: 'timing', duration: 240 }}
            className="bg-surface rounded-t-3xl overflow-hidden"
            // Sheet floor tracks the home-indicator inset instead of a flat
            // 48pt — comfortable clearance on gesture-nav devices, no dead
            // band on 0-inset (button-nav / notch-less) hardware.
            style={{ paddingBottom: Math.max(insets.bottom + 8, 28) }}
          >
            {/* Handle bar */}
            <View className="items-center pt-3 pb-1">
              <View className="w-10 h-1.5 rounded-full bg-divider" />
            </View>

            {/* Header */}
            <View className="flex-row items-center justify-between px-6 pt-2 pb-4">
              <View className="flex-1">
                <Text className="text-xl font-montserrat-bold text-textPrimary">
                  {title}
                </Text>
                {subtitle && (
                  <Text className="text-sm font-montserrat text-textTertiary mt-1">
                    {subtitle}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={handleClose}
                // 36pt visual circle + 8pt hitSlop = 52pt effective target.
                hitSlop={8}
                className="w-9 h-9 rounded-full bg-surfaceMuted items-center justify-center"
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <X size={18} color={LightColors.textTertiary} />
              </Pressable>
            </View>

            {stage === 'pick' ? (
              /* ─── Pick stage ─── */
              <View className="px-6 pb-4">
                {/* Camera option */}
                <Pressable
                  onPress={handleCamera}
                  accessibilityRole="button"
                  accessibilityLabel="Take a photo with your camera"
                  className="flex-row items-center gap-4 py-4 px-5 mb-3 rounded-2xl bg-primary/5 active:bg-primary/10"
                >
                  <MotiView
                    from={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', delay: 100 }}
                    className="w-14 h-14 rounded-2xl bg-primary items-center justify-center"
                  >
                    <Camera size={26} color={LightColors.textInverse} />
                  </MotiView>
                  <View className="flex-1">
                    <Text className="text-base font-montserrat-semi text-textPrimary">
                      Take a Photo
                    </Text>
                    <Text className="text-xs font-montserrat text-textTertiary mt-0.5">
                      Use your camera to capture now
                    </Text>
                  </View>
                </Pressable>

                {/* Gallery option */}
                <Pressable
                  onPress={handleGallery}
                  accessibilityRole="button"
                  accessibilityLabel="Choose a photo from your gallery"
                  className="flex-row items-center gap-4 py-4 px-5 rounded-2xl bg-primary/5 active:bg-primary/10"
                >
                  <MotiView
                    from={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', delay: 200 }}
                    className="w-14 h-14 rounded-2xl bg-primary400 items-center justify-center"
                  >
                    <ImageIcon size={26} color={LightColors.textInverse} />
                  </MotiView>
                  <View className="flex-1">
                    <Text className="text-base font-montserrat-semi text-textPrimary">
                      Choose from Gallery
                    </Text>
                    <Text className="text-xs font-montserrat text-textTertiary mt-0.5">
                      Select an existing photo from your library
                    </Text>
                  </View>
                </Pressable>
              </View>
            ) : (
              /* ─── Preview stage ─── */
              <View className="items-center px-6 pb-4">
                <MotiView
                  from={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', damping: 22, stiffness: 220 }}
                  className="rounded-2xl overflow-hidden mb-5"
                  style={{
                    width: PREVIEW_SIZE,
                    height: PREVIEW_SIZE,
                    shadowColor: LightColors.ink,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.12,
                    shadowRadius: 12,
                    elevation: 8,
                  }}
                >
                  {previewUri && (
                    <Image
                      source={{ uri: previewUri }}
                      style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
                      resizeMode="cover"
                    />
                  )}
                  {uploading && (
                    <View className="absolute inset-0 bg-black/40 items-center justify-center">
                      <Spinner kind="brand" size="large" color={LightColors.textInverse} />
                      <Text className="text-white font-montserrat-semi text-sm mt-3">
                        Uploading…
                      </Text>
                    </View>
                  )}
                </MotiView>

                {/* Action buttons */}
                <View className="flex-row gap-4 w-full">
                  <Pressable
                    onPress={handleRetake}
                    disabled={uploading}
                    accessibilityRole="button"
                    accessibilityLabel="Retake photo"
                    accessibilityState={{ disabled: uploading }}
                    className="flex-1 flex-row items-center justify-center gap-2 py-4 rounded-2xl bg-surfaceMuted active:bg-divider"
                  >
                    <RotateCcw size={18} color={LightColors.textTertiary} />
                    <Text className="text-sm font-montserrat-semi text-textSecondary">
                      Retake
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleConfirm}
                    disabled={uploading}
                    accessibilityRole="button"
                    accessibilityLabel={uploading ? 'Uploading photo' : 'Use this photo'}
                    accessibilityState={{ disabled: uploading }}
                    className="flex-1 flex-row items-center justify-center gap-2 py-4 rounded-2xl bg-primary active:bg-primaryDark"
                  >
                    {uploading ? (
                      <Spinner kind="brand" size="small" color={LightColors.textInverse} />
                    ) : (
                      <Check size={18} color={LightColors.textInverse} />
                    )}
                    <Text className="text-sm font-montserrat-semi text-white">
                      {uploading ? 'Uploading…' : 'Use Photo'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </MotiView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
