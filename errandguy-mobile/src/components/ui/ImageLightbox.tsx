import React, { useState } from 'react';
import {
  Modal,
  View,
  Pressable,
  Text,
  ActivityIndicator,
  Dimensions,
  StatusBar,
} from 'react-native';
import { Image } from 'expo-image';
import { Download, X } from 'lucide-react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { toast } from '../../stores/toastStore';

/**
 * `expo-media-library` is a native module — importing it eagerly crashes
 * the JS bundle on dev clients that haven't been rebuilt since we added
 * the dependency. Resolve it lazily so the rest of the chat keeps working
 * and we can fall back to a friendly toast that tells the user to rebuild.
 */
type MediaLibraryModule = typeof import('expo-media-library');
let mediaLibraryCache: MediaLibraryModule | null | undefined;
function tryRequireMediaLibrary(): MediaLibraryModule | null {
  if (mediaLibraryCache !== undefined) return mediaLibraryCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mediaLibraryCache = require('expo-media-library') as MediaLibraryModule;
  } catch {
    mediaLibraryCache = null;
  }
  return mediaLibraryCache;
}

interface ImageLightboxProps {
  /** Remote (CDN) image URL. Required to render anything. */
  uri: string | null;
  /** Whether the modal is currently visible. */
  visible: boolean;
  /** Close handler — invoked by tapping the backdrop or the X button. */
  onClose: () => void;
}

/**
 * Full-screen image preview with a Save-to-Photos action. We download
 * to a tmp file via expo-file-system then hand the result to the
 * MediaLibrary so the photo lands in the user's camera roll where they
 * expect it. Local URIs (file://) are saved directly without re-downloading.
 */
export function ImageLightbox({ uri, visible, onClose }: ImageLightboxProps) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!uri || downloading) return;
    const MediaLibrary = tryRequireMediaLibrary();
    if (!MediaLibrary) {
      // The native module isn't linked yet — happens after pulling fresh
      // code into a dev client built before expo-media-library landed.
      toast.error('Save unavailable. Please rebuild the app to enable downloads.');
      return;
    }
    setDownloading(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        toast.error('Photo library permission is required to save images.');
        return;
      }

      let localUri = uri;
      // Remote URLs must be downloaded into the app sandbox first; the
      // MediaLibrary API only accepts local file URIs.
      if (uri.startsWith('http')) {
        const filename = uri.split('/').pop()?.split('?')[0] || `chat-${Date.now()}.jpg`;
        const target = `${FileSystem.cacheDirectory}${filename}`;
        const result = await FileSystem.downloadAsync(uri, target);
        localUri = result.uri;
      }

      await MediaLibrary.saveToLibraryAsync(localUri);
      toast.success('Saved to Photos');
    } catch {
      toast.error('Couldn’t save image. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const { width, height } = Dimensions.get('window');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View className="flex-1 bg-black">
        {/* Tap anywhere on the backdrop to dismiss. */}
        <Pressable className="flex-1 items-center justify-center" onPress={onClose}>
          {uri ? (
            <Image
              source={{ uri }}
              style={{ width, height: height * 0.8 }}
              contentFit="contain"
              transition={200}
            />
          ) : null}
        </Pressable>

        {/* Top-right close button. */}
        <Pressable
          onPress={onClose}
          hitSlop={12}
          className="absolute top-14 right-5 w-10 h-10 rounded-full items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
          accessibilityRole="button"
          accessibilityLabel="Close image"
        >
          <X size={22} color="#FFFFFF" />
        </Pressable>

        {/* Bottom download button. */}
        <Pressable
          onPress={handleDownload}
          disabled={downloading || !uri}
          hitSlop={8}
          className="absolute bottom-12 self-center flex-row items-center px-5 py-3 rounded-full"
          style={{
            backgroundColor: 'rgba(255,255,255,0.95)',
            shadowColor: '#000',
            shadowOpacity: 0.3,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
            opacity: downloading || !uri ? 0.6 : 1,
          }}
          accessibilityRole="button"
          accessibilityLabel="Save image to photos"
        >
          {downloading ? (
            <ActivityIndicator size="small" color="#0F172A" />
          ) : (
            <Download size={18} color="#0F172A" />
          )}
          <Text className="ml-2 text-sm font-montserrat-bold text-textPrimary">
            {downloading ? 'Saving…' : 'Save to Photos'}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}
