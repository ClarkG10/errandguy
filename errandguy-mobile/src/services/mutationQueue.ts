import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { network, useNetworkStore } from '../stores/networkStore';
import { invalidateQuery } from '../hooks/useQuery';
import { notificationService } from './notification.service';
import { userService } from './user.service';
import { paymentService } from './payment.service';
import { runnerService } from './runner.service';
import { bookingService } from './booking.service';

/**
 * ── Scoped durable offline mutation queue ──────────────────────────────────
 *
 * When a *safe, last-write-wins* mutation is fired while the device is offline,
 * we DON'T roll the optimistic UI back — we persist the intent here and replay
 * it (in order) the moment connectivity returns. Survives an app kill because
 * the queue is written to AsyncStorage.
 *
 * This is deliberately NOT a general request queue. Only idempotent actions
 * whose *latest* value is the only thing that matters may be enqueued — think
 * "mark notification read", "set default address", "save profile name". Money
 * moves, booking-state transitions, auth, and anything that commits the user to
 * an irreversible side effect are NEVER queued (they reject → rollback → retry
 * toast, the existing behaviour). The allowlist below is the whole contract:
 * a `kind` with no handler here simply can't be queued.
 *
 * A write that isn't naturally last-write-wins may still be queued when the
 * SERVER makes a duplicate a no-op (see `booking.review`, where a second submit
 * 422s as "already reviewed"). The bar is the same: replaying it can never
 * produce an outcome the user didn't already ask for.
 *
 * DELIBERATELY NOT HERE — the SOS raise. It clears the replay-safety bar
 * (SOSService returns the existing active alert under a row lock and skips the
 * fan-out), but not the CADENCE bar: this queue only drains on the
 * offline→online edge and at boot, and the emergency case includes flaky signal
 * where a POST times out while `networkStore` still says "online" — no edge is
 * ever crossed, so a queued alarm would sit here indefinitely. It is also FIFO
 * across every kind, and an SOS must not wait behind five profile writes
 * backing off a 5xx. It lives in `services/sosIntent.ts`: same idea (persist
 * the intent, replay it), emergency cadence, 1h expiry instead of 24h, and a
 * stand-down that drops the intent first.
 *
 * Correctness guards:
 *   • Coalescing — enqueueing a `dedupeKey` drops any earlier pending entry
 *     with the same key, so only the newest value for a resource replays
 *     (toggling a preference 3× offline replays once).
 *   • Expiry — entries older than MAX_AGE_MS are dropped rather than replayed,
 *     so a change made days ago can't clobber newer server state on reconnect.
 *   • Attempt cap — a 5xx that keeps failing is dropped after MAX_ATTEMPTS; a
 *     4xx (the server rejected it outright) is dropped immediately — retrying
 *     a client error never helps.
 */

type QueryKey = (string | number | null | undefined)[];

export interface QueueSpec {
  /** Registry key — must exist in HANDLERS or enqueue is a no-op. */
  kind: string;
  /** JSON-serialisable args passed to the handler. */
  payload: unknown;
  /** Query keys to invalidate after a successful replay, so dependent reads
   *  refresh once the server has actually applied the change. */
  invalidate?: QueryKey[];
  /** Coalescing key. A new entry with the same key supersedes any pending one
   *  (last-write-wins). Omit for actions that must each replay independently
   *  (e.g. deleting three different contacts). */
  dedupeKey?: string;
}

interface QueuedMutation extends QueueSpec {
  id: string;
  createdAt: number;
  attempts: number;
  /**
   * The user this intent belongs to, stamped at enqueue.
   *
   * clearAccountScopedState() drops the whole queue on logout and on an
   * account switch, but the api layer's 401 path resets auth WITHOUT going
   * through it — so on a shared device an expired session could leave user
   * A's unsent writes on disk for user B's token to flush. The flush skips
   * entries whose owner isn't the current user, which closes that path too.
   * Undefined on entries written before this field existed: those are
   * treated as belonging to whoever is signed in, exactly as before.
   */
  userId?: string | null;
}

const STORAGE_KEY = '@mutation_queue_v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — older intents are dropped, not replayed.
const MAX_ATTEMPTS = 5;

/**
 * The allowlist. Each handler MUST map to the exact same network call the
 * screen's `commit` closure runs online, so an online commit and an offline
 * replay are indistinguishable to the server. Add a `kind` here ONLY for a
 * safe, idempotent, last-write-wins action.
 */
const HANDLERS: Record<string, (payload: any) => Promise<unknown>> = {
  // Notifications — all self-heal; replaying a read/archive/delete is harmless.
  'notification.markRead': ({ id }) => notificationService.markAsRead(id),
  'notification.markAllRead': () => notificationService.markAllAsRead(),
  'notification.archive': ({ id }) => notificationService.archiveNotification(id),
  'notification.unarchive': ({ id }) => notificationService.unarchiveNotification(id),
  'notification.delete': ({ id }) => notificationService.deleteNotification(id),
  'notification.clearAll': () => notificationService.clearAll(),

  // User profile / addresses / contacts — last-write-wins field saves.
  'user.updateProfile': (data) => userService.updateProfile(data),
  'user.addAddress': (data) => userService.addAddress(data),
  'user.updateAddress': ({ id, data }) => userService.updateAddress(id, data),
  'user.deleteAddress': ({ id }) => userService.deleteAddress(id),
  'user.addTrustedContact': (data) => userService.addTrustedContact(data),
  'user.updateTrustedContact': ({ id, data }) => userService.updateTrustedContact(id, data),
  'user.deleteTrustedContact': ({ id }) => userService.deleteTrustedContact(id),

  // Default payment method — display-only preference, no money moves.
  'payment.setDefaultMethod': ({ id }) => paymentService.setDefaultMethod(id),

  // Runner settings — preferred types, working area, profile fields.
  'runner.updateProfile': (data) => runnerService.updateRunnerProfile(data),

  // Shopping-checklist ticks. Item-scoped and last-write-wins by construction:
  // the endpoint flips ONLY the items it's handed, so replaying an item's newest
  // value is exactly what the runner meant — and the dead-signal grocery aisle is
  // precisely where this list gets used. NOT a booking-state transition: ticks are
  // informational, the status machine is untouched. A replay that lands after the
  // errand closed 422s and is dropped as permanent (below), which is correct.
  'runner.updateChecklistTicks': ({ bookingId, items }) =>
    runnerService.updateChecklistTicks(bookingId, items),

  // Multi-stop "visited this stop" ticks. Same bar as the checklist above and
  // for the same reason: the runner ticks a stop off at a gate, a basement
  // car park or a subdivision guardhouse — precisely where signal dies — and a
  // dropped tick must not un-visit a stop they actually reached. Stop-scoped
  // and last-write-wins (the PATCH stamps ONE stop's completed_at), and the
  // server makes a replay a no-op: it compares the requested state against the
  // stored one under a row lock and returns 200 having changed (and notified)
  // nothing. NOT a booking-state transition — the status ladder has no stop
  // stage; this is progress reporting on a column the customer already sees.
  // A replay that lands after the errand closed 422s and is dropped as
  // permanent, which is correct.
  'runner.completeStop': ({ bookingId, stopId, completed }) =>
    runnerService.completeStop(bookingId, stopId, completed),

  // Errand review (rating + comment). Content, never money — the tip is a
  // separate action and is NEVER queued. Replay is provably safe because the
  // server makes a second submit a no-op: it 422s with "already reviewed", which
  // IS the end state the user asked for, so we resolve on it exactly as the rate
  // screen does. Any other 4xx still rejects and the queue drops it.
  'booking.review': ({ bookingId, rating, comment }) =>
    bookingService
      .reviewBooking(bookingId, { rating, comment })
      .catch((err: any) => {
        // The api interceptor normalises to a flat `{ status }`; the axios shape
        // is checked too so this stays honest if a caller passes a raw error.
        const status = err?.status ?? err?.response?.status;
        if (status === 422) return null;
        throw err;
      }),
};

/** Is `kind` a registered, queueable action? */
export const isQueueable = (kind: string): boolean => kind in HANDLERS;

export interface QueueableResult {
  /** Run the mutation now (online path). Identical to what a reconnect replay
   *  runs, because both go through the same handler. */
  commit: () => Promise<unknown>;
  /** Descriptor to persist if we're offline. Feed straight to
   *  `runOptimistic({ offline })`. */
  offline: QueueSpec;
}

/**
 * Declare a queueable mutation ONCE and get back both an online `commit` closure
 * and the serialisable `offline` descriptor for `runOptimistic`. Using this
 * (instead of hand-writing both) guarantees an online commit and an offline
 * replay hit the server identically — they're the same handler.
 *
 *   const q = queueable('user.updateAddress',
 *     { id, data: { is_default: true } },
 *     { invalidate: [['user','addresses', userId]], dedupeKey: `addr-default` });
 *   await runOptimistic({ apply, rollback, ...q, retry: true });
 */
export function queueable(
  kind: string,
  payload: unknown,
  opts?: { invalidate?: QueryKey[]; dedupeKey?: string },
): QueueableResult {
  const handler = HANDLERS[kind];
  if (!handler) throw new Error(`queueable: no handler registered for "${kind}"`);
  return {
    commit: () => handler(payload),
    offline: { kind, payload, invalidate: opts?.invalidate, dedupeKey: opts?.dedupeKey },
  };
}

interface MutationQueueState {
  pending: QueuedMutation[];
  flushing: boolean;
  setPending: (next: QueuedMutation[]) => void;
  setFlushing: (v: boolean) => void;
}

/** Reactive store so UI (e.g. the offline banner) can show a pending count. */
export const useMutationQueueStore = create<MutationQueueState>((set) => ({
  pending: [],
  flushing: false,
  setPending: (pending) => set({ pending }),
  setFlushing: (flushing) => set({ flushing }),
}));

/** Signed-in user id, or null. Lazy require breaks the api↔authStore cycle. */
const currentUserId = (): string | null => {
  try {
    const { useAuthStore } = require('../stores/authStore');
    return useAuthStore.getState().user?.id ?? null;
  } catch {
    return null;
  }
};

const getPending = () => useMutationQueueStore.getState().pending;
const setPending = (next: QueuedMutation[]) =>
  useMutationQueueStore.getState().setPending(next);

const persist = (list: QueuedMutation[]) =>
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list)).catch(() => {});

/** Drop entries past their expiry. Pure — returns a possibly-shorter list. */
const dropExpired = (list: QueuedMutation[], now: number) =>
  list.filter((m) => now - m.createdAt < MAX_AGE_MS);

/**
 * Persist a mutation for replay-on-reconnect. Returns the entry id, or null if
 * `kind` isn't queueable (caller should treat that as "can't queue"). Coalesces
 * on `dedupeKey`. Does NOT run the mutation — the caller has already applied the
 * optimistic UI; this only guarantees the server eventually hears about it.
 */
export function enqueueMutation(spec: QueueSpec): string | null {
  if (!isQueueable(spec.kind)) return null;
  const id = Crypto.randomUUID();
  const entry: QueuedMutation = {
    ...spec,
    id,
    createdAt: Date.now(),
    attempts: 0,
    userId: currentUserId(),
  };
  const current = spec.dedupeKey
    ? getPending().filter((m) => m.dedupeKey !== spec.dedupeKey)
    : getPending();
  const next = [...current, entry];
  setPending(next);
  void persist(next);
  return id;
}

const isPermanentError = (err: any): boolean => {
  const status = err?.status;
  // 4xx (except 408 Request Timeout / 429 Too Many Requests) = the server
  // rejected it on its own terms; replaying won't change the verdict.
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
};

let flushChain: Promise<void> = Promise.resolve();

/**
 * Replay every pending mutation in FIFO order. Safe to call repeatedly and
 * concurrently — calls are serialised and a no-op while offline or empty. Stops
 * early (leaving the rest queued) the instant connectivity drops again.
 */
export function flushMutationQueue(): Promise<void> {
  // Serialise: chain onto any in-flight flush so two reconnect signals can't
  // replay the same entry twice.
  flushChain = flushChain.then(() => runFlush());
  return flushChain;
}

async function runFlush(): Promise<void> {
  if (network.isOffline()) return;
  const store = useMutationQueueStore.getState();
  if (store.flushing) return;

  // Expire stale entries up front.
  const now = Date.now();
  let list = dropExpired(getPending(), now);
  if (list.length === 0) {
    if (list.length !== getPending().length) {
      setPending(list);
      void persist(list);
    }
    return;
  }

  store.setFlushing(true);
  try {
    // Snapshot ids to process; re-read the live list each iteration so a
    // concurrently-enqueued item written during the flush isn't lost.
    const activeUserId = currentUserId();
    for (const entry of [...list]) {
      if (network.isOffline()) break; // dropped connection mid-flush — resume later.
      // Never replay another account's intent under this session's token.
      // See QueuedMutation.userId — the 401 path resets auth without running
      // the account purge, so this is the backstop for a shared handset.
      if (entry.userId && activeUserId && entry.userId !== activeUserId) {
        list = list.filter((m) => m.id !== entry.id);
        setPending(list);
        void persist(list);
        continue;
      }
      const handler = HANDLERS[entry.kind];
      if (!handler) {
        // Handler removed in an app update — discard rather than wedge the queue.
        remove(entry.id);
        continue;
      }
      try {
        await handler(entry.payload);
        if (entry.invalidate?.length) {
          await Promise.all(entry.invalidate.map((k) => invalidateQuery(k)));
        }
        remove(entry.id);
      } catch (err) {
        if (network.isOffline()) break; // failure was the connection dropping.
        if (isPermanentError(err) || entry.attempts + 1 >= MAX_ATTEMPTS) {
          // The server rejected this queued change (e.g. a 409 conflict) or we
          // exhausted retries. Drop it AND reconcile the UI to server truth so a
          // rejected optimistic value doesn't linger on screen.
          if (entry.invalidate?.length) {
            await Promise.all(entry.invalidate.map((k) => invalidateQuery(k))).catch(() => {});
          }
          remove(entry.id); // give up — a client error or exhausted retries.
        } else {
          bumpAttempt(entry.id); // transient (5xx) — keep for the next reconnect.
        }
      }
    }
  } finally {
    useMutationQueueStore.getState().setFlushing(false);
  }
}

const remove = (id: string) => {
  const next = getPending().filter((m) => m.id !== id);
  setPending(next);
  void persist(next);
};

const bumpAttempt = (id: string) => {
  const next = getPending().map((m) =>
    m.id === id ? { ...m, attempts: m.attempts + 1 } : m,
  );
  setPending(next);
  void persist(next);
};

let initialised = false;

/**
 * Load persisted entries and wire the reconnect flush. Call once at app root.
 * Idempotent. On an offline→online transition (and immediately, if we boot up
 * online with a non-empty queue) the queue drains.
 */
export async function initMutationQueue(): Promise<void> {
  if (initialised) return;
  initialised = true;
  // Fully guarded — queue init must NEVER be able to affect app startup. Any
  // failure here degrades to "no offline queue this session", not a broken boot.
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as QueuedMutation[];
      const pruned = dropExpired(Array.isArray(parsed) ? parsed : [], Date.now());
      setPending(pruned);
      if (pruned.length !== (Array.isArray(parsed) ? parsed.length : 0)) {
        void persist(pruned);
      }
    }

    // Flush whenever we come back online. networkStore already no-ops on
    // unchanged transitions, so this only fires on a real offline→online edge.
    useNetworkStore.subscribe((state, prev) => {
      if (prev.isOffline && !state.isOffline) void flushMutationQueue();
    });

    // Booted online with a backlog (queued last session, killed before draining).
    if (!network.isOffline() && getPending().length > 0) {
      void flushMutationQueue();
    }
  } catch {
    // Corrupt payload / unavailable storage — start clean rather than crash.
  }
}

/** Test/logout helper — drop everything. */
export async function clearMutationQueue(): Promise<void> {
  setPending([]);
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

/** Reactive pending count for UI. */
export const useQueuedMutationCount = () =>
  useMutationQueueStore((s) => s.pending.length);
