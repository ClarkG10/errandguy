import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/**
 * ── "SOS active", remembered per errand ───────────────────────────────────
 *
 * The SOS-active card used to live in screen state. Leave the tracking screen
 * (or the runner cockpit) and come back, and the card was gone while the alert
 * was still open on the server — so the one control that stands it down
 * ("I'm safe") disappeared, and the person had no sign anyone had been told.
 *
 * Each server-acknowledged raise is now written to disk under its booking and
 * every SOS surface renders from this store. It is reconciled three ways:
 *   • this device's own "I'm safe" removes it (`clearSosActive`);
 *   • ErrandGuy staff closing the alert sends an `sos` notification with
 *     `status: 'resolved'` → the card flips to "closed" and says when
 *     (`noteSosNotification`);
 *   • a FRESH booking read with `sos_triggered === false` means no alert is
 *     open any more → also "closed" (`reconcileSosActive`). Only `false` is
 *     acted on: `true` may be the other person's alert, and a missing field is
 *     an older or masked payload.
 *
 * Kept separate from `sosIntent.ts` (the unsent-raise retry loop) so the
 * logout cleanup can import it without pulling in the network services.
 */

export type SosRole = 'customer' | 'runner';

/** Who closed an alert this device did not stand down itself. */
export type SosResolvedBy = 'staff' | 'server';

export interface SosActiveRecord {
  bookingId: string;
  role: SosRole;
  /** Device time the server acknowledged the raise. */
  acknowledgedAt: number;
  /** The server's own sentence about who it alerted, when it sent an honest
   *  one. Null → the surfaces fall back to "ErrandGuy support". */
  alertedLine: string | null;
  /** Trusted-contact ids the server confirmed it reached (may be empty). */
  contacts: string[];
  /** Set when the alert was closed by someone other than this device. */
  resolvedAt: number | null;
  resolvedBy: SosResolvedBy | null;
}

type RecordMap = Record<string, SosActiveRecord>;

interface SosActiveState {
  records: RecordMap;
  hydrated: boolean;
}

export const STORAGE_KEY = '@sos_active_v1';

/** A record older than this is dropped on load — an alert's live link lasts an
 *  hour, and a card still claiming "SOS active" a day later helps nobody. */
export const MAX_RECORD_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * A booking read is only trusted to say "closed" when it was taken this long
 * after the raise was acknowledged. Reads are micro-cached for a few seconds
 * and the booking store can hold a pre-SOS snapshot, so a read straight after
 * the raise can still carry `sos_triggered: false` from before it.
 */
export const RECONCILE_GRACE_MS = 20_000;

export const useSosActiveStore = create<SosActiveState>(() => ({
  records: {},
  hydrated: false,
}));

const get = () => useSosActiveStore.getState();

const persist = (records: RecordMap) => {
  const write =
    Object.keys(records).length > 0
      ? AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records))
      : AsyncStorage.removeItem(STORAGE_KEY);
  return write.catch(() => {});
};

const commit = (records: RecordMap) => {
  useSosActiveStore.setState({ records });
  // Before the stored copy is loaded, writing now would overwrite it with this
  // partial map; hydration merges the two and writes the result instead.
  if (!get().hydrated) {
    void hydrateSosActive();
    return;
  }
  void persist(records);
};

const isRecord = (v: unknown): v is SosActiveRecord => {
  const r = v as Partial<SosActiveRecord> | null;
  return (
    !!r &&
    typeof r.bookingId === 'string' &&
    r.bookingId.length > 0 &&
    (r.role === 'customer' || r.role === 'runner') &&
    typeof r.acknowledgedAt === 'number'
  );
};

let hydration: Promise<void> | null = null;

/**
 * Load the persisted records once. Every SOS surface calls this on mount;
 * concurrent callers share one read. A record written before hydration
 * finishes (a raise acknowledged during boot) wins over the stored copy.
 */
export function hydrateSosActive(): Promise<void> {
  if (get().hydrated) return Promise.resolve();
  if (hydration) return hydration;
  hydration = (async () => {
    let stored: RecordMap = {};
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') {
        const now = Date.now();
        for (const value of Object.values(parsed as Record<string, unknown>)) {
          if (isRecord(value) && now - value.acknowledgedAt < MAX_RECORD_AGE_MS) {
            stored[value.bookingId] = {
              bookingId: value.bookingId,
              role: value.role,
              acknowledgedAt: value.acknowledgedAt,
              alertedLine: typeof value.alertedLine === 'string' ? value.alertedLine : null,
              contacts: Array.isArray(value.contacts)
                ? value.contacts.filter((c): c is string => typeof c === 'string')
                : [],
              resolvedAt: typeof value.resolvedAt === 'number' ? value.resolvedAt : null,
              resolvedBy:
                value.resolvedBy === 'staff' || value.resolvedBy === 'server'
                  ? value.resolvedBy
                  : null,
            };
          }
        }
      }
    } catch {
      // Corrupt payload — start clean rather than wedge an emergency surface.
      stored = {};
    }
    const merged = { ...stored, ...get().records };
    useSosActiveStore.setState({ records: merged, hydrated: true });
    void persist(merged);
  })().finally(() => {
    hydration = null;
  });
  return hydration;
}

/**
 * The server acknowledged a raise. An idempotent replay (the server returns
 * the alert that is already open) keeps the original time so the elapsed
 * clock doesn't restart.
 */
export function recordSosActive(input: {
  bookingId: string;
  role: SosRole;
  alertedLine: string | null;
  contacts: string[];
}): void {
  const existing = get().records[input.bookingId];
  const keep = existing && !existing.resolvedAt ? existing : null;
  commit({
    ...get().records,
    [input.bookingId]: {
      bookingId: input.bookingId,
      role: input.role,
      acknowledgedAt: keep?.acknowledgedAt ?? Date.now(),
      alertedLine: input.alertedLine ?? keep?.alertedLine ?? null,
      contacts: input.contacts.length > 0 ? input.contacts : keep?.contacts ?? [],
      resolvedAt: null,
      resolvedBy: null,
    },
  });
}

/** Mark an open alert as closed by someone else. No-op without an open one. */
export function markSosResolved(
  bookingId: string,
  by: SosResolvedBy,
  at: number = Date.now(),
): void {
  const existing = get().records[bookingId];
  if (!existing || existing.resolvedAt) return;
  commit({
    ...get().records,
    [bookingId]: { ...existing, resolvedAt: at, resolvedBy: by },
  });
}

/** This device stood the alert down (or dismissed the "closed" notice). */
export function clearSosActive(bookingId: string): void {
  if (!get().records[bookingId]) return;
  const next = { ...get().records };
  delete next[bookingId];
  commit(next);
}

/**
 * Feed a booking read into the record. Only `sos_triggered === false` from a
 * read taken comfortably after the acknowledgement closes the card.
 */
export function reconcileSosActive(
  bookingId: string,
  sosTriggered: boolean | null | undefined,
  readAt: number = Date.now(),
): void {
  if (sosTriggered !== false) return;
  const existing = get().records[bookingId];
  if (!existing || existing.resolvedAt) return;
  if (readAt - existing.acknowledgedAt < RECONCILE_GRACE_MS) return;
  markSosResolved(bookingId, 'server', readAt);
}

/**
 * Route a delivered notification. Staff closing an alert sends
 * `{ type: 'sos', status: 'resolved', booking_id }` to the person who raised
 * it; anything else (an `active` banner about someone else's alert) is ignored.
 */
export async function noteSosNotification(
  notification:
    | { type?: string | null; data?: Record<string, unknown> | null; created_at?: string | null }
    | null
    | undefined,
): Promise<void> {
  const data = notification?.data ?? {};
  const type = notification?.type || (typeof data.type === 'string' ? data.type : null);
  if (type !== 'sos' || data.status !== 'resolved') return;
  const bookingId =
    typeof data.booking_id === 'string'
      ? data.booking_id
      : typeof data.booking_id === 'number'
        ? String(data.booking_id)
        : null;
  if (!bookingId) return;
  await hydrateSosActive();
  const parsed = notification?.created_at ? Date.parse(notification.created_at) : NaN;
  markSosResolved(bookingId, 'staff', Number.isFinite(parsed) ? parsed : Date.now());
}

/** Reactive view of one booking's record (null when none). */
export function useSosActive(bookingId: string | null | undefined): SosActiveRecord | null {
  return useSosActiveStore((s) => (bookingId ? s.records[bookingId] ?? null : null));
}

/** Logout / account switch — the records belong to the signed-in account. */
export async function clearAllSosActive(): Promise<void> {
  useSosActiveStore.setState({ records: {}, hydrated: true });
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

/** Test helper: forget everything, including the hydrated flag. */
export function resetSosActiveForTests(): void {
  hydration = null;
  useSosActiveStore.setState({ records: {}, hydrated: false });
}
