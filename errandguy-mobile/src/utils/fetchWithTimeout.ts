/**
 * `fetch` that gives up after `timeoutMs`.
 *
 * React Native's fetch has no read timeout on Android: a request whose
 * connection stalls never settles. The map and geocoding calls share one
 * in-flight request per key, so a stalled one pinned that entry for good and
 * every retry ("Retry route") was handed the same hung promise. Aborting
 * rejects it instead; the callers' own `finally` then drops the entry and the
 * next call goes out fresh.
 *
 * RN's fetch resolves once the whole response has arrived, so reading the body
 * afterwards can't stall on the network.
 */
export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
