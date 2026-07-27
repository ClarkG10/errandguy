import { invalidateQuery } from '../hooks/useQuery';
import { toast } from '../stores/toastStore';
import { network } from '../stores/networkStore';
import { enqueueMutation, type QueueSpec } from '../services/mutationQueue';

type QueryKey = (string | number | null | undefined)[];

export interface OptimisticOptions {
  /** Apply the expected change to the UI immediately (before the server
   *  confirms). Update a zustand store, call a useQuery `mutate`, set local
   *  state — whatever the screen uses. */
  apply: () => void | Promise<void>;
  /** Undo `apply`. Called only if `commit` rejects, restoring the prior UI. */
  rollback: () => void | Promise<void>;
  /** The real network mutation. */
  commit: () => Promise<unknown>;
  /** Query keys to invalidate on success so dependent reads refresh (the
   *  cache-invalidation cascade, e.g. accept-booking → dashboard + active
   *  booking + runner status). */
  invalidate?: QueryKey[];
  /** Error toast shown after rollback. Pass null to stay silent (e.g. when
   *  the caller shows its own inline error). */
  errorMessage?: string | null;
  /** Runs after a successful commit — success toast/animation, navigation… */
  onSuccess?: () => void;
  /** Runs after rollback, before the error toast — for custom failure handling
   *  (surface an inline field error, re-open a sheet, log…). */
  onError?: (err: unknown) => void;
  /** Offer a one-tap "Retry" on the failure toast that re-runs the whole
   *  optimistic cycle (apply → commit). Pass a string to relabel the action.
   *  Only meaningful alongside a non-null `errorMessage`. Default false. */
  retry?: boolean | string;
  /** Make this action survive being fired while OFFLINE: rather than failing
   *  and rolling back, the optimistic UI is kept and the mutation is persisted
   *  for replay on reconnect. ONLY pass for safe, idempotent, last-write-wins
   *  actions — build it with `queueable()` so the online commit and the offline
   *  replay hit the server identically. Money / booking-state / auth actions
   *  must NOT set this. */
  offline?: QueueSpec;
  /** Info toast shown when the action is queued offline. Pass null to stay
   *  silent. Ignored unless `offline` is set. */
  offlineMessage?: string | null;
  /** Conflict resolution. When the commit fails with HTTP 409 (the server
   *  state moved out from under our optimistic change), rolling back to the
   *  now-also-stale local value isn't enough — we refetch these keys so the UI
   *  reconciles to server truth (server-wins). Defaults to `invalidate`. */
  reconcileOnConflict?: QueryKey[];
  /** Message shown when a 409 conflict is detected and reconciled. Pass null to
   *  stay silent. */
  conflictMessage?: string | null;
}

const DEFAULT_OFFLINE_MESSAGE = "Saved — we'll sync it when you're back online.";
const DEFAULT_CONFLICT_MESSAGE = 'This was just updated elsewhere — showing the latest version.';

/**
 * Run a mutation optimistically.
 *
 *   1. Apply the change to the UI right away (instant feedback).
 *   2. Commit to the server in the background.
 *   3a. Success → keep the change, invalidate dependent queries, onSuccess().
 *   3b. Failure → roll the UI back to its previous state + surface an error
 *       (with an optional one-tap Retry).
 *   3c. Offline (only when `offline` is set) → keep the change and queue the
 *       mutation for replay on reconnect instead of rolling back.
 *
 * Store-agnostic on purpose: the caller owns `apply`/`rollback`, so this works
 * with useQuery's `mutate`, a zustand store, or plain component state. Capture
 * the snapshot the rollback needs BEFORE calling this (in the closure).
 *
 *   const prev = notif.is_read;
 *   await runOptimistic({
 *     apply:    () => setRead(id, true),
 *     rollback: () => setRead(id, prev),
 *     commit:   () => notificationService.markRead(id),
 *     invalidate: [['notifications']],
 *     errorMessage: "Couldn't mark as read.",
 *     retry: true,
 *   });
 *
 * @returns true if committed (or queued offline), false if it failed (already
 *          rolled back).
 */
export async function runOptimistic(options: OptimisticOptions): Promise<boolean> {
  const {
    apply,
    rollback,
    commit,
    invalidate,
    errorMessage = 'Something went wrong. Please try again.',
    onSuccess,
    onError,
    retry = false,
    offline,
    offlineMessage = DEFAULT_OFFLINE_MESSAGE,
    reconcileOnConflict,
    conflictMessage = DEFAULT_CONFLICT_MESSAGE,
  } = options;

  await apply();

  // Already known-offline and this action is queueable → don't even attempt the
  // network call; persist for replay and keep the optimistic UI.
  if (offline && network.isOffline() && queueOffline(offline, onSuccess, offlineMessage)) {
    return true;
  }

  try {
    await commit();
    if (invalidate?.length) {
      await Promise.all(invalidate.map((k) => invalidateQuery(k)));
    }
    onSuccess?.();
    return true;
  } catch (err) {
    // The commit failed *because* connectivity just dropped (the flag flips in
    // the api interceptor as the request errors) → queue rather than roll back.
    if (offline && network.isOffline() && queueOffline(offline, onSuccess, offlineMessage)) {
      return true;
    }
    await rollback();
    onError?.(err);
    // Conflict detection + resolution: a 409 means the resource changed under
    // our optimistic write (a concurrent edit / another device). Rolling back
    // to the local value would leave it stale too, so reconcile to SERVER truth
    // by refetching, and tell the user their change didn't stick because the
    // item moved — never a plain "try again" (retrying would re-conflict).
    if ((err as { status?: number } | null)?.status === 409) {
      const keys = reconcileOnConflict ?? invalidate;
      if (keys?.length) {
        await Promise.all(keys.map((k) => invalidateQuery(k)));
      }
      if (conflictMessage) toast.warning(conflictMessage);
      return false;
    }
    if (errorMessage) {
      if (retry) {
        toast.error(errorMessage, {
          actionLabel: typeof retry === 'string' ? retry : 'Retry',
          onAction: () => {
            void runOptimistic(options);
          },
        });
      } else {
        toast.error(errorMessage);
      }
    }
    return false;
  }
}

/** Enqueue for reconnect replay; returns false if the kind wasn't queueable
 *  (so the caller falls through to the normal commit/rollback path). */
function queueOffline(
  spec: QueueSpec,
  onSuccess: (() => void) | undefined,
  offlineMessage: string | null,
): boolean {
  const id = enqueueMutation(spec);
  if (!id) return false;
  onSuccess?.();
  if (offlineMessage) toast.info(offlineMessage);
  return true;
}
