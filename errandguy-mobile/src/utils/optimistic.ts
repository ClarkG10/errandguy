import { invalidateQuery } from '../hooks/useQuery';
import { toast } from '../stores/toastStore';

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
}

/**
 * Run a mutation optimistically.
 *
 *   1. Apply the change to the UI right away (instant feedback).
 *   2. Commit to the server in the background.
 *   3a. Success → keep the change, invalidate dependent queries, onSuccess().
 *   3b. Failure → roll the UI back to its previous state + surface an error.
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
 *   });
 *
 * @returns true if committed, false if it failed (already rolled back).
 */
export async function runOptimistic({
  apply,
  rollback,
  commit,
  invalidate,
  errorMessage = 'Something went wrong. Please try again.',
  onSuccess,
}: OptimisticOptions): Promise<boolean> {
  await apply();
  try {
    await commit();
    if (invalidate?.length) {
      await Promise.all(invalidate.map((k) => invalidateQuery(k)));
    }
    onSuccess?.();
    return true;
  } catch {
    await rollback();
    if (errorMessage) toast.error(errorMessage);
    return false;
  }
}
