import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { network, useNetworkStore } from '../stores/networkStore';
import { bookingService } from './booking.service';
import { runnerService } from './runner.service';
import { errorMessage } from '../utils/errorCatalog';
import { copy } from '../constants/copy';

/**
 * ── The panic button, made durable ────────────────────────────────────────
 *
 * SOS was a bare `api.post`: mutations bypass the api layer's retry
 * (`api.ts` — "Mutations are NEVER retried here"), so in a basement car park
 * or on a provincial road the request failed with status 0 and the person in
 * danger got a toast. Nothing was ever re-sent.
 *
 * WHY NOT the offline mutation queue (`mutationQueue.ts`) — the other obvious
 * home for this:
 *   • Its only replay triggers are the offline→online EDGE and app boot. The
 *     emergency case includes flaky signal, where a POST times out while
 *     NetInfo/`networkStore` still say "online" — no edge is ever crossed, so
 *     a queued SOS would sit there indefinitely. This loop retries on a timer
 *     as well as on reconnect and on foreground.
 *   • It is FIFO across every kind. An SOS must never wait behind five
 *     profile writes backing off a 5xx.
 *   • Its expiry is 24h and its contract explicitly excludes anything that
 *     "commits the user to an irreversible side effect". A day-old alarm is
 *     not something to raise silently; this loop expires an unsent intent
 *     after `MAX_INTENT_AGE_MS` (one hour — the same life the server gives an
 *     alert's live link).
 * So: same *idea* (persist the intent, replay it), separate, tiny loop with
 * emergency cadence. What makes replay safe is the server, not us —
 * `SOSService::triggerSOS` re-reads under `lockForUpdate` and returns the
 * EXISTING active alert without re-running the fan-out, so a duplicate send is
 * a provable no-op.
 *
 * The intent is persisted BEFORE the first attempt, so an app kill mid-request
 * cannot lose it; the next mount of an SOS surface resumes the loop.
 *
 * Stand-down MUST drop the intent first (`standDownSos`) — otherwise a queued
 * replay would re-raise an alert the user already cancelled.
 */

export type SosRole = 'customer' | 'runner';

/** Unsent SOS. Written to disk the moment the button is pressed. */
export interface SosIntent {
  bookingId: string;
  role: SosRole;
  /** When the person actually pressed it (not when we last tried). */
  triggeredAt: number;
  attempts: number;
  lastAttemptAt: number | null;
}

/** Server acknowledgement of a raise — including one that landed on a retry. */
export interface SosAck {
  bookingId: string;
  acknowledgedAt: number;
  /** Contact ids the server recorded on the alert (may be empty). */
  contacts: string[];
}

export type SosRaiseResult =
  | { status: 'sent'; contacts: string[] }
  /** Not sent yet; the intent is on disk and the loop keeps trying. */
  | { status: 'queued'; error: unknown }
  /** The server refused on its own terms (errand closed, not ours) — dropped. */
  | { status: 'rejected'; error: unknown };

const STORAGE_KEY = '@sos_intent_v1';
/** Short per-attempt timeout: in an emergency, fail fast and retry, don't hang
 *  for the client default of 30s with no feedback. */
const SOS_TIMEOUT_MS = 8_000;
/** Retry cadence, then the last value repeats. Aggressive on purpose. */
const RETRY_DELAYS_MS = [4_000, 8_000, 15_000, 30_000, 45_000];
/** An unsent intent older than this is abandoned rather than replayed — the
 *  same hour the server keeps an alert's live link alive. */
export const MAX_INTENT_AGE_MS = 60 * 60 * 1000;

interface SosIntentState {
  /** The unsent intent, or null. Reactive so the SOS surfaces can stay honest. */
  intent: SosIntent | null;
  /** True while an attempt is in flight. */
  sending: boolean;
  /** Last failure, for honest copy. Null once sent or dropped. */
  lastError: unknown;
  /** Set when the server ACKs — including from a background retry, so a screen
   *  that showed "not sent yet" can flip itself to "SOS active". */
  lastAck: SosAck | null;
  /** Set when the server REFUSED and the intent was dropped (e.g. the errand
   *  closed while we were retrying), so a surface can stop promising. */
  lastRejection: { bookingId: string; error: unknown } | null;
}

export const useSosIntentStore = create<SosIntentState>(() => ({
  intent: null,
  sending: false,
  lastError: null,
  lastAck: null,
  lastRejection: null,
}));

const set = (patch: Partial<SosIntentState>) => useSosIntentStore.setState(patch);
const get = () => useSosIntentStore.getState();

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let wired = false;
let inFlight = false;

const clearTimer = () => {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
};

const persist = (intent: SosIntent | null) => {
  const write = intent
    ? AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(intent))
    : AsyncStorage.removeItem(STORAGE_KEY);
  return write.catch(() => {});
};

/** A 4xx the server owns (bar 408/429) can't be fixed by resending. */
const isPermanentError = (err: any): boolean => {
  const status = err?.status ?? err?.response?.status;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
};

const postSos = (intent: SosIntent) =>
  intent.role === 'runner'
    ? runnerService.triggerSOS(intent.bookingId, { timeoutMs: SOS_TIMEOUT_MS })
    : bookingService.triggerSOS(intent.bookingId, { timeoutMs: SOS_TIMEOUT_MS });

/** Best-effort stand-down used ONLY by the in-flight race below. */
const postStandDown = (role: SosRole, bookingId: string) => {
  try {
    const p =
      role === 'runner'
        ? runnerService.deactivateSOS(bookingId)
        : bookingService.deactivateSOS(bookingId);
    void Promise.resolve(p).catch(() => {});
  } catch {
    // Service unavailable in this environment — nothing further to do.
  }
};

/**
 * When each booking was last stood down. Only the newest matters: it exists to
 * catch the one race a retry loop can lose — the user presses "I'm safe" WHILE
 * an attempt is in flight, so the alert is created a moment after they thought
 * they'd cancelled it. That ACK must not surface as "SOS active", and the
 * now-real alert has to be stood down for real.
 */
let standDownAt: { bookingId: string; at: number } | null = null;

/** Contact ids off the alert payload. Tolerant — shape differences must never
 *  turn a successful raise into a failure. */
const readContacts = (res: any): string[] => {
  const notified = res?.data?.data?.contacts_notified ?? res?.data?.contacts_notified;
  return Array.isArray(notified)
    ? notified.filter((c: unknown): c is string => typeof c === 'string' && c.length > 0)
    : [];
};

const dropIntent = (reason: 'sent' | 'stood_down' | 'rejected' | 'expired') => {
  clearTimer();
  set({
    intent: null,
    sending: false,
    lastError: reason === 'sent' || reason === 'stood_down' ? null : get().lastError,
  });
  void persist(null);
};

/** One attempt. Never throws. Returns what the caller should tell the user. */
async function attempt(intent: SosIntent): Promise<SosRaiseResult> {
  if (inFlight) return { status: 'queued', error: get().lastError };
  inFlight = true;
  const attempting: SosIntent = {
    ...intent,
    attempts: intent.attempts + 1,
    lastAttemptAt: Date.now(),
  };
  set({ intent: attempting, sending: true });
  void persist(attempting);
  try {
    const res = await postSos(attempting);
    const contacts = readContacts(res);
    // Stood down while this very attempt was on the wire: the server now holds
    // an alert the user already cancelled. Cancel it for real and never show
    // it as active.
    if (
      standDownAt &&
      standDownAt.bookingId === attempting.bookingId &&
      standDownAt.at >= (attempting.lastAttemptAt ?? 0)
    ) {
      postStandDown(attempting.role, attempting.bookingId);
      dropIntent('stood_down');
      return {
        status: 'rejected',
        error: { status: 409, kind: 'conflict', message: 'Alert cancelled' },
      };
    }
    set({
      lastAck: {
        bookingId: attempting.bookingId,
        acknowledgedAt: Date.now(),
        contacts,
      },
      lastRejection: null,
      lastError: null,
    });
    dropIntent('sent');
    return { status: 'sent', contacts };
  } catch (err) {
    set({ sending: false, lastError: err });
    if (isPermanentError(err)) {
      // The server rejected it on its own terms (booking completed/cancelled →
      // 404, or not ours → 403). Resending can't change that verdict.
      set({ lastRejection: { bookingId: attempting.bookingId, error: err } });
      dropIntent('rejected');
      return { status: 'rejected', error: err };
    }
    scheduleRetry(attempting);
    return { status: 'queued', error: err };
  } finally {
    inFlight = false;
  }
}

/** Abandon an intent we can no longer honestly keep promising to send. */
const expireIntent = (intent: SosIntent) => {
  set({
    lastRejection: {
      bookingId: intent.bookingId,
      error: {
        status: 0,
        kind: 'offline',
        message: "We couldn't send your SOS. Please call for help directly.",
      },
    },
  });
  dropIntent('expired');
};

function scheduleRetry(intent: SosIntent) {
  clearTimer();
  if (Date.now() - intent.triggeredAt >= MAX_INTENT_AGE_MS) {
    expireIntent(intent);
    return;
  }
  const idx = Math.min(intent.attempts - 1, RETRY_DELAYS_MS.length - 1);
  const delay = RETRY_DELAYS_MS[Math.max(0, idx)];
  retryTimer = setTimeout(() => {
    retryTimer = null;
    const live = get().intent;
    if (!live || live.bookingId !== intent.bookingId) return;
    void attempt(live);
  }, delay);
}

/**
 * Wire the two edges that make an emergency retry land as soon as it can:
 * connectivity coming back, and the app returning to the foreground (the phone
 * was pocketed, or iOS suspended our timers). Registered lazily so importing
 * this module has no side effects.
 */
function wireEdges() {
  if (wired) return;
  wired = true;
  try {
    useNetworkStore.subscribe((state, prev) => {
      if (prev.isOffline && !state.isOffline) retryNow();
    });
    AppState.addEventListener('change', (s) => {
      if (s === 'active') retryNow();
    });
  } catch {
    // No store/AppState in this environment — the timer loop still runs.
  }
}

/** Try again immediately (also the "Try sending now" button). Safe to spam. */
export function retryNow(): void {
  const intent = get().intent;
  if (!intent || inFlight) return;
  if (Date.now() - intent.triggeredAt >= MAX_INTENT_AGE_MS) {
    expireIntent(intent);
    return;
  }
  clearTimer();
  void attempt(intent);
}

/**
 * Pull the alarm. Persists the intent first, then fires one short attempt and
 * resolves with what actually happened — the caller keeps its modal open and
 * honest on `queued` instead of showing a dead-end toast.
 */
export async function raiseSos(
  bookingId: string,
  role: SosRole,
): Promise<SosRaiseResult> {
  wireEdges();
  clearTimer();
  // A fresh press supersedes any earlier stand-down for this booking.
  if (standDownAt?.bookingId === bookingId) standDownAt = null;
  const existing = get().intent;
  const intent: SosIntent =
    existing && existing.bookingId === bookingId
      ? existing
      : {
          bookingId,
          role,
          triggeredAt: Date.now(),
          attempts: 0,
          lastAttemptAt: null,
        };
  set({ intent, lastError: null, lastRejection: null });
  await persist(intent);
  return attempt(intent);
}

/**
 * Stand down. Drops any UNSENT intent FIRST — a replay after the user said
 * "I'm safe" would re-raise the alarm they just cancelled — then reports
 * whether anything was still queued so the caller can be honest about what it
 * is cancelling.
 */
export function standDownSos(bookingId: string): { hadUnsentIntent: boolean } {
  const intent = get().intent;
  const hadUnsentIntent = !!intent && intent.bookingId === bookingId;
  // Stamp FIRST, so an attempt already on the wire is caught by the race guard
  // in attempt() rather than surfacing as a live alert after the stand-down.
  standDownAt = { bookingId, at: Date.now() };
  clearTimer();
  if (hadUnsentIntent) {
    set({ intent: null, sending: false, lastError: null });
    void persist(null);
  }
  const ack = get().lastAck;
  if (ack?.bookingId === bookingId) set({ lastAck: null });
  const rejection = get().lastRejection;
  if (rejection?.bookingId === bookingId) set({ lastRejection: null });
  return { hadUnsentIntent };
}

/**
 * Rehydrate a persisted intent and resume retrying. Called on mount by every
 * screen that can raise an SOS, so an app killed mid-request picks the alarm
 * back up the moment the person opens the app again.
 */
export async function resumeSosIntent(): Promise<SosIntent | null> {
  wireEdges();
  if (get().intent) {
    if (!retryTimer && !inFlight) retryNow();
    return get().intent;
  }
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SosIntent;
    if (!parsed?.bookingId || !parsed?.triggeredAt) {
      await persist(null);
      return null;
    }
    if (Date.now() - parsed.triggeredAt >= MAX_INTENT_AGE_MS) {
      await persist(null);
      return null;
    }
    set({ intent: parsed });
    if (!network.isOffline()) retryNow();
    else scheduleRetry(parsed);
    return parsed;
  } catch {
    // Corrupt payload — start clean rather than wedge an emergency path.
    await persist(null);
    return null;
  }
}

/**
 * Honest, actionable copy for a raise that will NOT be sent.
 *
 * Two shapes reach here and they need different sentences:
 *  • a permanent 4xx — the SOS controllers `findOrFail` a booking that is
 *    neither completed nor cancelled, so this is nearly always "the errand is
 *    closed". The raw Laravel "No query results for model [Booking]" message
 *    must never be what someone in an emergency reads.
 *  • an abandoned intent (an hour of no signal) — an `offline`-kind error whose
 *    class copy ("check your connection and try again") is true and useless, so
 *    the caller's safety copy is kept via `preferFallback`.
 */
export function describeSosFailure(err: unknown): string {
  const status = (err as { status?: number } | null | undefined)?.status;
  if (status === 404 || status === 403 || status === 422) {
    return 'This errand is closed, so SOS can’t be sent. Call 911 if you need help now.';
  }
  return errorMessage(err, copy.safety.sosFailed, { preferFallback: true });
}

/**
 * The surface has shown the "we couldn't send it" state — clear it so a later
 * re-mount doesn't re-announce an old failure.
 */
export function acknowledgeSosRejection(bookingId: string): void {
  const rejection = get().lastRejection;
  if (rejection?.bookingId === bookingId) set({ lastRejection: null });
}

/** Reactive view for one booking's SOS surface. */
export function useQueuedSos(bookingId: string | null | undefined) {
  return useSosIntentStore((s) =>
    bookingId && s.intent?.bookingId === bookingId ? s.intent : null,
  );
}

/** Test/logout helper — drop everything, including the timers. */
export async function clearSosIntent(): Promise<void> {
  clearTimer();
  inFlight = false;
  standDownAt = null;
  set({
    intent: null,
    sending: false,
    lastError: null,
    lastAck: null,
    lastRejection: null,
  });
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
