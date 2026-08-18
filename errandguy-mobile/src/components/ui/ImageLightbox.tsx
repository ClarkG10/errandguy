import React, { useState } from 'react';
import {
  Modal,
  View,
  Pressable,
  Text,
  useWindowDimensions,
  StatusBar,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Download, X } from 'lucide-react-native';
import { toast } from '../../stores/toastStore';
import { LightColors } from '../../constants/colors';
import { Spinner } from './Spinner';
import { mediaSource } from '../../utils/mediaSource';

/**
 * Both `expo-media-library` and `expo-file-system` are native modules.
 * If the dev client hasn't been rebuilt since they were added (or version-
 * bumped), `import` and even Metro-static `require()` will crash the
 * entire JS bundle at module evaluation. We resolve them through a
 * fully-opaque indirection (an array index + spread) so Metro's static
 * analyzer can't pre-bundle the dependency, and any failure is caught
 * by the try/catch — falling back to a friendly toast.
 */
function tryRequire<T = any>(moduleName: string): T | null {
  try {
    // Indirect access prevents Metro from statically resolving the
    // dependency; the require call only fires when the user taps Save.
    const req = (globalThis as any).require ?? (() => null);
    return req(moduleName) as T;
  } catch {
    return null;
  }
}

let mediaLibraryCache: any | null | undefined;
let fileSystemCache: any | null | undefined;
function getMediaLibrary(): any | null {
  if (mediaLibraryCache !== undefined) return mediaLibraryCache;
  mediaLibraryCache = tryRequire('expo-media-library');
  return mediaLibraryCache;
}
function getFileSystem(): any | null {
  if (fileSystemCache !== undefined) return fileSystemCache;
  // The legacy submodule has the imperative downloadAsync we need.
  fileSystemCache = tryRequire('expo-file-system/legacy');
  return fileSystemCache;
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
    const MediaLibrary = getMediaLibrary();
    const FileSystem = getFileSystem();
    if (!MediaLibrary || !FileSystem) {
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

  const { width, height } = useWindowDimensions();
  // statusBarTranslucent full-screen modal: chrome must clear the
  // Dynamic Island / notch (top inset up to 59pt) and the home
  // indicator — a fixed offset either grazes the island on Pro Max or
  // floats pointlessly low in landscape (inset 0).
  const insets = useSafeAreaInsets();

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
              source={mediaSource(uri)}
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
          className="absolute right-5 w-10 h-10 rounded-full items-center justify-center"
          style={{
            top: Math.max(insets.top, 16) + 4,
            backgroundColor: 'rgba(0,0,0,0.55)',
          }}
          accessibilityRole="button"
          accessibilityLabel="Close image"
        >
          <X size={22} color={LightColors.textInverse} />
        </Pressable>

        {/* Bottom download button. */}
        <Pressable
          onPress={handleDownload}
          disabled={downloading || !uri}
          hitSlop={8}
          className="absolute self-center flex-row items-center px-5 py-3 rounded-full"
          style={{
            bottom: Math.max(insets.bottom, 16) + 16,
            backgroundColor: `${LightColors.surface}F2`,
            shadowColor: LightColors.ink,
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
            <Spinner size="small" color={LightColors.textPrimary} />
          ) : (
            <Download size={18} color={LightColors.textPrimary} />
          )}
          <Text className="ml-2 text-sm font-montserrat-bold text-textPrimary">
            {downloading ? 'Saving…' : 'Save to Photos'}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}
