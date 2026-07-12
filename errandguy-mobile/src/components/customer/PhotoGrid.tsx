import React, { useCallback, useState } from 'react';
import { View, Pressable, Text } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { X, Camera, ImageOff } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';

interface PhotoGridProps {
  photos: string[];
  maxPhotos?: number;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

export function PhotoGrid({
  photos,
  maxPhotos = 5,
  onAdd,
  onRemove,
}: PhotoGridProps) {
  const canAdd = photos.length < maxPhotos;

  // URIs that failed to load (e.g. a purged camera-cache file after the
  // draft was restored) — swap the broken tile for an explicit glyph so
  // the user knows to remove/retake it instead of staring at a gray box.
  const [failedUris, setFailedUris] = useState<Record<string, true>>({});
  const markFailed = useCallback((uri: string) => {
    setFailedUris((prev) => (prev[uri] ? prev : { ...prev, [uri]: true }));
  }, []);

  return (
    <View className="mb-4">
      <View className="flex-row items-baseline justify-between mb-2">
        {/* Canonical section eyebrow — matches the funnel's other headers. */}
        <Text
          className="text-[10px] font-montserrat-bold uppercase text-textSecondary"
          style={{ letterSpacing: 1.4 }}
        >
          Item Photos
        </Text>
        <Text className="text-xs font-montserrat text-textTertiary">
          {photos.length}/{maxPhotos}
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-3">
        {photos.map((uri, index) => (
          <View
            // uri in the key so undo re-inserts don't recycle the wrong tile.
            key={`${uri}-${index}`}
            className="w-20 h-20 rounded-lg overflow-hidden bg-divider"
          >
            {failedUris[uri] ? (
              <View className="w-full h-full items-center justify-center bg-surfaceMuted">
                <ImageOff size={22} color={LightColors.textTertiary} strokeWidth={2} />
              </View>
            ) : (
              <Image
                source={{ uri }}
                // expo-image isn't NativeWind-registered — size it via
                // style or the thumb renders zero-sized.
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                transition={150}
                accessibilityLabel={`Item photo ${index + 1}`}
                onError={() => markFailed(uri)}
              />
            )}
            <Pressable
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-danger items-center justify-center"
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${index + 1}`}
              hitSlop={12}
              style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
              onPress={() => {
                // Destructive outcome — warn, don't celebrate.
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Warning,
                ).catch(() => {});
                onRemove(index);
              }}
            >
              <X size={12} color={LightColors.textInverse} />
            </Pressable>
          </View>
        ))}
        {canAdd && (
          <Pressable
            // dividerStrong: the plain divider dash was near-invisible
            // (~1.1:1 on white) for what is an interactive affordance.
            className="w-20 h-20 rounded-lg border-2 border-dashed border-dividerStrong items-center justify-center bg-surface"
            accessibilityRole="button"
            accessibilityLabel="Add item photo"
            style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                () => {},
              );
              onAdd();
            }}
          >
            <Camera size={24} color={LightColors.textTertiary} />
            <Text className="text-[10px] font-montserrat text-textSecondary mt-1">
              Add
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
