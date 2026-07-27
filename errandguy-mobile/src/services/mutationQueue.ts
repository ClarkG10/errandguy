import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { network, useNetworkStore } from '../stores/networkStore';
import { invalidateQuery } from '../hooks/useQuery';
import { notificationService } from './notification.service';
import { userService } from './user.service';
import { paymentService } from './payment.service';
import { runnerService } from './runner.service';

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
    for (const entry of [...list]) {
      if (network.isOffline()) break; // dropped connection mid-flush — resume later.
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
