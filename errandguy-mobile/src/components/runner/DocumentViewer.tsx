import React, { useState } from 'react';
import { View, Text, Modal, Pressable, useWindowDimensions, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';
import { Spinner } from '../ui/Spinner';
import { mediaSource } from '../../utils/mediaSource';

interface DocumentViewerProps {
  visible: boolean;
  uri: string | null;
  title?: string;
  onClose: () => void;
}

/**
 * Full-screen previewer for an uploaded document image.
 *
 * Uses `expo-image` so the preview is served from the in-memory + disk
 * cache after the first open — re-opening the same document later
 * (during a re-upload review, for example) is instant.
 */
export function DocumentViewer({ visible, uri, title, onClose }: DocumentViewerProps) {
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();
  // Track the live window dimensions so an orientation change while
  // the viewer is open re-flows the image to fill the new viewport.
  const { width: SW, height: SH } = useWindowDimensions();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 20,
            paddingTop: insets.top + 8,
            paddingBottom: 12,
          }}
        >
          <Text
            style={{
              flex: 1,
              fontSize: 16,
              color: LightColors.textInverse,
              fontFamily: 'Quicksand_600SemiBold',
            }}
            numberOfLines={1}
          >
            {title ?? 'Document'}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={16}
            accessibilityRole="button"
            accessibilityLabel="Close preview"
            style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={26} color={LightColors.textInverse} />
          </Pressable>
        </View>

        <Pressable
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }}
          onPress={onClose}
        >
          {uri ? (
            <>
              <Image
                source={mediaSource(uri)}
                // Fixed inline dimensions are required — expo-image will
                // not size itself from flex children alone.
                style={{ width: SW - 24, height: SH * 0.72 }}
                contentFit="contain"
                cachePolicy="memory-disk"
                onLoadStart={() => setLoading(true)}
                onLoadEnd={() => setLoading(false)}
                onError={() => setLoading(false)}
                transition={200}
              />
              {loading && (
                <View style={{ position: 'absolute' }}>
                  <Spinner color={LightColors.textInverse} size="large" />
                </View>
              )}
            </>
          ) : (
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'Quicksand_400Regular' }}>
              No file to preview
            </Text>
          )}
        </Pressable>

        <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 12, paddingTop: 8 }}>
          <Text
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.6)',
              fontFamily: 'Quicksand_400Regular',
              textAlign: 'center',
            }}
          >
            Tap anywhere to close
          </Text>
        </View>
      </View>
    </Modal>
  );
}
