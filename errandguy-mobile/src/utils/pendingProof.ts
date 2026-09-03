import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * ── The proof photo that must not be lost ─────────────────────────────────
 *
 * picked_up / delivered carry their proof photo on the SAME multipart request
 * as the status transition. The captured URI lived only in component state, so
 * any failure threw the photo away: the CTA re-ran `setShowPhotoProof(...)` and
 * PhotoProofModal mounted with `photoUri: null` — an empty camera, at a
 * doorstep the runner may already have driven away from. An app kill mid-upload
 * was worse: the compressed file was still on disk, but nothing remembered it
 * existed.
 *
 * So the URI is persisted the moment the photo is compressed, and (where
 * expo-file-system is available) the file is copied out of the OS cache
 * directory into documentDirectory first, because the cache dir is exactly what
 * the OS reclaims under pressure.
 *
 * This is NOT a queue and NOT an auto-replay. Status transitions are booking
 * state and the mutation queue's contract rightly forbids them; what this gives
 * is a persisted local artifact plus a resume affordance, so the runner always
 * presses the button. The record is cleared on server confirmation and on any
 * 4xx (the errand closed or already advanced — the photo is moot).
 */

export type ProofPhase = 'pickup' | 'delivery';

export interface PendingProof {
  bookingId: string;
  phase: ProofPhase;
  /** Local file URI of the COMPRESSED capture, ready to re-submit as-is. */
  uri: string;
  /** ISO-8601 capture time — shown to the runner ("your proof from 4:12pm"). */
  capturedAt: string;
  /** The status this photo was captured to accompany. */
  status: string;
}

const STORAGE_KEY = '@pending_proof_v1';
/** A runner works one errand at a time, so one record is the whole contract. */

/** expo-file-system is a native module — absent in Expo Go / an out-of-sync
 *  dev client. Missing it only means the URI isn't hardened; never a failure. */
type LegacyFs = {
  documentDirectory: string | null;
  copyAsync: (opts: { from: string; to: string }) => Promise<void>;
  getInfoAsync: (uri: string) => Promise<{ exists: boolean }>;
  deleteAsync: (uri: string, opts?: { idempotent?: boolean }) => Promise<void>;
};
let fsCache: LegacyFs | null | undefined;
const fs = (): LegacyFs | null => {
  if (fsCache !== undefined) return fsCache;
  try {
    fsCache = require('expo-file-system/legacy') as LegacyFs;
  } catch {
    fsCache = null;
  }
  return fsCache;
};

/** Move the capture somewhere the OS won't reclaim. Returns a usable URI
 *  either way — the original is still far better than nothing. */
async function hardenUri(uri: string, bookingId: string, phase: ProofPhase): Promise<string> {
  const f = fs();
  if (!f?.documentDirectory || !uri.startsWith('file:')) return uri;
  try {
    const to = `${f.documentDirectory}proof-${bookingId}-${phase}.jpg`;
    if (to === uri) return uri;
    try {
      await f.deleteAsync(to, { idempotent: true });
    } catch {
      // Nothing there (or undeletable) — copyAsync below decides the outcome.
    }
    await f.copyAsync({ from: uri, to });
    return to;
  } catch {
    return uri;
  }
}

/**
 * Persist the intent to upload THIS photo for THIS transition. Call it before
 * the request starts, so an app kill mid-upload can't lose the capture.
 * Resolves to the stored record (whose `uri` may have been hardened).
 */
export async function savePendingProof(record: PendingProof): Promise<PendingProof> {
  const uri = await hardenUri(record.uri, record.bookingId, record.phase);
  const stored: PendingProof = { ...record, uri };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable — the in-memory retry path still has the URI.
  }
  return stored;
}

/**
 * The pending proof for `bookingId`, or null. A record whose file has since
 * vanished is dropped rather than offered, so the runner is never invited to
 * "send now" a photo that no longer exists.
 */
export async function readPendingProof(bookingId: string): Promise<PendingProof | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingProof;
    if (!parsed?.bookingId || !parsed?.uri || parsed.bookingId !== bookingId) return null;
    const f = fs();
    if (f && parsed.uri.startsWith('file:')) {
      const info = await f.getInfoAsync(parsed.uri).catch(() => ({ exists: true }));
      if (!info?.exists) {
        await clearPendingProof();
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Drop the record (server confirmed it, the runner retook the photo, or the
 *  errand moved on). Never throws. */
export async function clearPendingProof(bookingId?: string): Promise<void> {
  try {
    if (bookingId) {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PendingProof;
        if (parsed?.bookingId && parsed.bookingId !== bookingId) return;
      }
    }
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — a stale record is filtered by readPendingProof's checks.
  }
}
