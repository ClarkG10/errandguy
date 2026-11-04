/**
 * The server's default for `matched_acceptance_timeout_seconds` — how long a
 * runner has to accept an offered errand before it goes to someone else.
 * Only a fallback: the real value rides the runner's own profile as
 * `offer_accept_seconds`, so a staff change reaches the help page.
 */
export const OFFER_ACCEPT_SECONDS_FALLBACK = 90;

/** The accept window staff have set, read off the runner's own profile, else the fallback. */
export function offerAcceptSeconds(runnerProfile?: unknown): number {
  const raw = (runnerProfile as { offer_accept_seconds?: unknown } | null | undefined)
    ?.offer_accept_seconds;
  const seconds = Number(raw);
  return raw != null && raw !== '' && Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds)
    : OFFER_ACCEPT_SECONDS_FALLBACK;
}

/**
 * "about 90 seconds" / "about 2 minutes" — the window as the help copy says
 * it. Whole minutes from two minutes up; seconds otherwise, so 90 still reads
 * exactly as it always has.
 */
export function offerWindowPhrase(seconds: number): string {
  if (seconds >= 120 && seconds % 60 === 0) return `about ${seconds / 60} minutes`;
  return `about ${seconds} seconds`;
}
