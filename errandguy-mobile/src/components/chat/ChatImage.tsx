import React, { memo, useState } from 'react';
import { Image, type ImageLoadEventData } from 'expo-image';
import { LightColors } from '../../constants/colors';

interface ChatImageProps {
  /** Already-resolved absolute image URL. */
  uri: string;
  /** Fixed width of the image box (px). */
  width: number;
  borderRadius: number;
  /** Height is clamped to [minHeight, maxHeight]; a square `width` box is
   *  reserved until the intrinsic aspect ratio is known. */
  minHeight: number;
  maxHeight: number;
  marginBottom?: number;
}

/**
 * A single chat photo that holds its intrinsic aspect ratio in LOCAL state.
 *
 * Previously every image's aspect lived in one `imageAspects` map that the
 * inverted FlatList's `renderRow` closed over, so each photo's `onLoad`
 * replaced the map object — changing `renderRow`'s identity and re-rendering
 * every visible message cell on one of the app's hottest surfaces. Owning the
 * aspect here means a resolving photo re-renders only its own bubble. (P12)
 *
 * Shared by the customer and runner chat screens (the block was previously
 * duplicated verbatim in both).
 */
export const ChatImage = memo(function ChatImage({
  uri,
  width,
  borderRadius,
  minHeight,
  maxHeight,
  marginBottom,
}: ChatImageProps) {
  const [aspect, setAspect] = useState<number | null>(null);
  // Real aspect once known (from onLoad); a square `width`×`width` box until
  // then. Height clamped so panoramas / tall shots can't blow up the list.
  const height = aspect
    ? Math.round(Math.min(maxHeight, Math.max(minHeight, width / aspect)))
    : width;

  return (
    <Image
      source={{ uri }}
      style={{ width, height, borderRadius, marginBottom, backgroundColor: LightColors.divider }}
      contentFit="cover"
      transition={150}
      cachePolicy="memory-disk"
      onLoad={(e: ImageLoadEventData) => {
        const { width: w, height: h } = e.source ?? {};
        if (!w || !h) return;
        setAspect((prev) => prev ?? w / h);
      }}
    />
  );
});
