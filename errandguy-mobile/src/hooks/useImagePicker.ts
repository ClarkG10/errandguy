import { useState, useCallback } from 'react';
import * as ImagePicker from 'expo-image-picker';

interface ImageResult {
  uri: string;
  base64?: string;
}

export function useImagePicker() {
  const [image, setImage] = useState<ImageResult | null>(null);

  const pickImage = useCallback(async () => {
    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return null;

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
  }, []);

  const takePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') return null;

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
  }, []);

  return { image, pickImage, takePhoto };
}
