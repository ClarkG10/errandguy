import {
  ImageManipulator,
  SaveFormat,
} from 'expo-image-manipulator';

/**
 * Downscale + recompress a proof capture before it goes up the wire.
 *
 * ImagePicker hands back the camera's native frame — on a modern phone that's
 * a ~4000px, multi-MB JPEG for what is, semantically, a "this is where I left
 * the parcel" snapshot. Over provincial LTE that turns the handover into
 * 10–30s of dead air at the customer's door. 1600px on the longest edge keeps
 * receipt print and door numbers legible while cutting the payload ~5–10×.
 *
 * DELIBERATELY forgiving: any failure (module missing from an older native
 * build, unreadable URI, remote URL) resolves to the ORIGINAL uri so the
 * upload still happens at full size. A compression hiccup must never cost a
 * runner their proof-of-delivery.
 */

/** Longest-edge ceiling. Receipts stay readable at this size — don't go lower. */
export const PROOF_MAX_EDGE = 1600;
/** JPEG quality. Matches what useImagePicker already captures at. */
export const PROOF_COMPRESS = 0.8;

export interface CompressProofOptions {
  /** Longest-edge ceiling in px. Defaults to PROOF_MAX_EDGE. */
  maxEdge?: number;
  /** JPEG quality 0–1. Defaults to PROOF_COMPRESS. */
  compress?: number;
}

/**
 * True for URIs we can actually manipulate on-device. Remote URLs (an
 * already-uploaded photo echoed back by the API) and placeholder sentinels
 * (CompletionModal's 'signature_placeholder') are passed through untouched.
 */
function isLocalImageUri(uri: string): boolean {
  return (
    uri.startsWith('file:') ||
    uri.startsWith('content:') ||
    uri.startsWith('ph:') ||
    uri.startsWith('assets-library:') ||
    uri.startsWith('data:image')
  );
}

export async function compressProofImage(
  uri: string | null | undefined,
  opts?: CompressProofOptions,
): Promise<string | null> {
  if (!uri) return uri ?? null;
  if (!isLocalImageUri(uri)) return uri;

  const maxEdge = opts?.maxEdge ?? PROOF_MAX_EDGE;
  const compress = opts?.compress ?? PROOF_COMPRESS;

  try {
    // Render once to learn the real dimensions — resize() only takes ONE
    // dimension if the aspect ratio is to be preserved, and which one depends
    // on orientation.
    const rendered = await ImageManipulator.manipulate(uri).renderAsync();
    const longest = Math.max(rendered.width, rendered.height);

    if (!Number.isFinite(longest) || longest <= 0) return uri;

    if (longest <= maxEdge) {
      // Already small enough — just recompress the rendered frame.
      const saved = await rendered.saveAsync({
        compress,
        format: SaveFormat.JPEG,
      });
      return saved.uri || uri;
    }

    const size =
      rendered.width >= rendered.height
        ? { width: maxEdge }
        : { height: maxEdge };
    const resized = await ImageManipulator.manipulate(uri)
      .resize(size)
      .renderAsync();
    const saved = await resized.saveAsync({
      compress,
      format: SaveFormat.JPEG,
    });
    return saved.uri || uri;
  } catch {
    // Never block the upload on a failed optimisation.
    return uri;
  }
}
