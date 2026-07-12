import React from 'react';
import { type ViewStyle, type StyleProp } from 'react-native';
import { ProgressBar } from './ProgressBar';

/**
 * Determinate upload feedback built on <ProgressBar>. Give it the raw upload
 * fraction from axios `onUploadProgress` (loaded/total) and it renders an
 * honest bar with a "{label}… NN%" caption.
 *
 * The bytes-sent fraction hits 1.0 BEFORE the server has finished processing
 * the image (resize / CDN write), so we:
 *   • hold the determinate bar at 92% for the last stretch (never claim 100%
 *     while the socket is still flushing), and
 *   • flip to an indeterminate "Finishing up…" sweep once bytes-sent reaches
 *     100%, until the caller's upload promise actually resolves.
 *
 * Pass `progress = null` (or omit) when a call can't report bytes — it falls
 * back to an indeterminate sweep with the base label, still better than a
 * bare spinner.
 */
interface UploadProgressProps {
  /** 0–1 upload fraction (loaded/total). null/undefined → indeterminate. */
  progress?: number | null;
  /** Action verb, e.g. "Uploading photo". Trailing "…"/"%" are added. */
  label?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

export function UploadProgress({
  progress,
  label = 'Uploading',
  height = 6,
  style,
}: UploadProgressProps) {
  const known = typeof progress === 'number' && progress >= 0;

  // Unknown progress, or bytes-sent complete but promise still pending →
  // indeterminate "Finishing up…" (server-side processing window).
  if (!known || (progress as number) >= 1) {
    const finishing = known && (progress as number) >= 1;
    return (
      <ProgressBar
        indeterminate
        label={finishing ? 'Finishing up…' : `${label}…`}
        height={height}
        style={style}
      />
    );
  }

  const shown = Math.min(progress as number, 0.92);
  return (
    <ProgressBar
      progress={shown}
      label={`${label}… ${Math.round(shown * 100)}%`}
      height={height}
      style={style}
    />
  );
}
