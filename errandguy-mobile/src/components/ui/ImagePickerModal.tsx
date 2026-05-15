import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  Image,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { MotiView } from 'moti';
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
  /** Show a loading spinner overlay after confirm (e.g. while uploading) */
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') return;

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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;

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
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onConfirm(previewUri);
    reset();
  }, [previewUri, onConfirm, reset]);

  const handleRetake = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
        className="flex-1 bg-black/50 justify-end"
        onPress={handleClose}
      >
        <Pressable onPress={(e) => e.stopPropagation()}>
          <MotiView
            from={{ translateY: 400, opacity: 0 }}
            animate={{ translateY: 0, opacity: 1 }}
            exit={{ translateY: 400, opacity: 0 }}
            transition={{ type: 'timing', duration: 240 }}
            className="bg-surface pb-12"
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
                className="w-9 h-9 rounded-full bg-gray-100 items-center justify-center"
              >
                <X size={18} color="#64748B" />
              </Pressable>
            </View>

            {stage === 'pick' ? (
              /* ─── Pick stage ─── */
              <View className="px-6 pb-4">
                {/* Camera option */}
                <Pressable
                  onPress={handleCamera}
                  className="flex-row items-center gap-4 py-4 px-5 mb-3 rounded-2xl bg-primary/5 active:bg-primary/10"
                >
                  <MotiView
                    from={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', delay: 100 }}
                    className="w-14 h-14 rounded-2xl bg-primary items-center justify-center"
                  >
                    <Camera size={26} color="#FFF" />
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
                  className="flex-row items-center gap-4 py-4 px-5 rounded-2xl bg-primary/5 active:bg-primary/10"
                >
                  <MotiView
                    from={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', delay: 200 }}
                    className="w-14 h-14 rounded-2xl bg-blue-400 items-center justify-center"
                  >
                    <ImageIcon size={26} color="#FFF" />
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
                    shadowColor: '#000',
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
                      <ActivityIndicator size="large" color="#FFF" />
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
                    className="flex-1 flex-row items-center justify-center gap-2 py-4 rounded-2xl bg-gray-100 active:bg-gray-200"
                  >
                    <RotateCcw size={18} color="#64748B" />
                    <Text className="text-sm font-montserrat-semi text-textSecondary">
                      Retake
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleConfirm}
                    disabled={uploading}
                    className="flex-1 flex-row items-center justify-center gap-2 py-4 rounded-2xl bg-primary active:bg-blue-700"
                  >
                    {uploading ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Check size={18} color="#FFF" />
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
