import { useState, useCallback } from 'react';
import * as ImagePicker from 'expo-image-picker';

interface ImageResult {
  uri: string;
  base64?: string;
}

/** Which source was denied, so callers can tailor the recovery copy
 *  ("Camera access is off" vs "Photo access is off"). */
export type ImagePickerSource = 'camera' | 'library';

interface UseImagePickerOptions {
  /** Fired when the OS permission for a source is not granted. Lets a
   *  caller surface a recovery path (e.g. a Settings toast) instead of
   *  the silent null return the picker otherwise gives. Optional so the
   *  existing { pickImage, takePhoto } => uri|null contract is untouched
   *  for callers that don't opt in. */
  onPermissionDenied?: (source: ImagePickerSource) => void;
}

export function useImagePicker(options?: UseImagePickerOptions) {
  const [image, setImage] = useState<ImageResult | null>(null);
  const onPermissionDenied = options?.onPermissionDenied;

  const pickImage = useCallback(async () => {
    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      onPermissionDenied?.('library');
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      const picked = {
        uri: result.assets[0].uri,
        base64: result.assets[0].base64 ?? undefined,
      };
      setImage(picked);
      return picked;
    }
    return null;
  }, [onPermissionDenied]);

  const takePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      onPermissionDenied?.('camera');
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      const taken = {
        uri: result.assets[0].uri,
        base64: result.assets[0].base64 ?? undefined,
      };
      setImage(taken);
      return taken;
    }
    return null;
  }, [onPermissionDenied]);

  return { image, pickImage, takePhoto };
}
