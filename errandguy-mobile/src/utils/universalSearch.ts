/**
 * Pure match / rank helpers for the customer Universal Search screen.
 *
 * The screen federates over four already-cached data sources (bookings,
 * conversations, saved addresses, wallet transactions) and filters them
 * entirely client-side. Everything ranking-related lives here so it stays
 * dependency-free and unit-testable in isolation from the React tree.
 *
 * Ranking is deliberately coarse — three tiers so exact hits float to the
 * top, prefix hits sit under them, and looser substring hits fill the
 * tail. Within a tier the original (server-provided) order is preserved so
 * a query never reshuffles otherwise-equal rows.
 */

/** Match strength of a single field against the query. Higher is better. */
export const MatchRank = {
  None: 0,
  Substring: 1,
  Prefix: 2,
  Exact: 3,
} as const;

export type MatchRankValue = (typeof MatchRank)[keyof typeof MatchRank];

/** Lower-case + trim, tolerant of null/undefined/number inputs. */
export function normalizeText(value: unknown): string {
  if (value == null) return '';
  return String(value).toLowerCase().trim();
}

/**
 * Score a single field against the query.
 *
 *   exact match      → 3
 *   starts-with      → 2
 *   contains         → 1
 *   no match / empty → 0
 *
 * Case-insensitive; an empty query or empty field always scores 0.
 */
export function scoreMatch(query: string, text: unknown): MatchRankValue {
  const q = normalizeText(query);
  if (!q) return MatchRank.None;
  const t = normalizeText(text);
  if (!t) return MatchRank.None;
  if (t === q) return MatchRank.Exact;
  if (t.startsWith(q)) return MatchRank.Prefix;
  if (t.includes(q)) return MatchRank.Substring;
  return MatchRank.None;
}

/**
 * Best score across several fields of one item — the item's overall rank.
 * Short-circuits as soon as an exact hit is found.
 */
export function scoreFields(query: string, fields: unknown[]): MatchRankValue {
  let best: MatchRankValue = MatchRank.None;
  for (const field of fields) {
    const s = scoreMatch(query, field);
    if (s > best) best = s;
    if (best === MatchRank.Exact) break;
  }
  return best;
}

export interface RankOptions {
  /** Cap the returned list to this many items (before capping we still
   *  know the true total via {@link rankAndCount}). */
  limit?: number;
}

/**
 * Rank a list of items against the query, dropping non-matches and sorting
 * exact → prefix → substring. Ties keep their original relative order
 * (stable). Returns the matching items only (not the scores).
 */
export function rankBy<T>(
  query: string,
  items: readonly T[],
  getFields: (item: T) => unknown[],
  options: RankOptions = {},
): T[] {
  const q = normalizeText(query);
  if (!q || items.length === 0) return [];

  const scored: { item: T; score: MatchRankValue; index: number }[] = [];
  items.forEach((item, index) => {
    const score = scoreFields(q, getFields(item));
    if (score > MatchRank.None) scored.push({ item, score, index });
  });

  // Descending by score, then ascending by original index so equal-tier
  // rows never get reshuffled by the sort.
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const ranked = scored.map((s) => s.item);
  return options.limit != null ? ranked.slice(0, options.limit) : ranked;
}

export interface RankedResult<T> {
  /** Items after ranking + capping — what the UI renders. */
  items: T[];
  /** Total number of matches before the cap (for the "+N more" affordance). */
  total: number;
}

/**
 * Like {@link rankBy} but also reports the pre-cap match count so the UI can
 * show a truthful "+N more" instead of silently dropping matches.
 */
export function rankAndCount<T>(
  query: string,
  items: readonly T[],
  getFields: (item: T) => unknown[],
  limit: number,
): RankedResult<T> {
  const all = rankBy(query, items, getFields);
  return { items: all.slice(0, limit), total: all.length };
}

export interface HighlightSegment {
  text: string;
  /** True when this segment is an occurrence of the query. */
  hit: boolean;
}

/**
 * Split `text` into ordered segments marking every case-insensitive
 * occurrence of `query`, so the UI can emphasise WHY a row matched.
 * Concatenating the segments always reproduces `text` exactly. Empty
 * text → empty array; empty query → one non-hit segment.
 */
export function highlightSegments(query: string, text: string): HighlightSegment[] {
  const t = text ?? '';
  if (!t) return [];
  const q = normalizeText(query);
  if (!q) return [{ text: t, hit: false }];

  const lower = t.toLowerCase();
  const segments: HighlightSegment[] = [];
  let pos = 0;
  let idx = lower.indexOf(q, pos);
  while (idx !== -1) {
    if (idx > pos) segments.push({ text: t.slice(pos, idx), hit: false });
    segments.push({ text: t.slice(idx, idx + q.length), hit: true });
    pos = idx + q.length;
    idx = lower.indexOf(q, pos);
  }
  if (pos < t.length) segments.push({ text: t.slice(pos), hit: false });
  return segments;
}
