/**
 * Run best-effort async tasks with a bounded concurrency, so a burst of work
 * (e.g. cold-start warm-up) doesn't fire a dozen requests at once and starve
 * whatever the user actually needs first.
 *
 * Tasks are THUNKS (`() => Promise`) so they don't self-start — the pool
 * decides when each fires. Order is preserved: workers pull from the front, so
 * earlier (higher-priority) tasks start first. Per-task rejections are
 * swallowed so one failure never rejects the whole batch (matches
 * `Promise.allSettled` semantics); pass tasks that handle their own errors if
 * they need bespoke handling.
 *
 * @param tasks thunks to run
 * @param limit max number in flight at once (default 4)
 */
export const runPool = async (
  tasks: Array<() => Promise<unknown>>,
  limit = 4,
): Promise<void> => {
  let i = 0;
  const worker = async () => {
    while (i < tasks.length) {
      const t = tasks[i++];
      try {
        await t();
      } catch {
        /* best-effort — a failing task never rejects the pool */
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
};
