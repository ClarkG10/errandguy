import * as ImageManipulator from 'expo-image-manipulator';

export async function resizeImage(
  uri: string,
  maxWidth: number = 1024,
): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxWidth } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
  );
  return result.uri;
}

export async function compressImage(
  uri: string,
  quality: number = 0.7,
): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(uri, [], {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}
