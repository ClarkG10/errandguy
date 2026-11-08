/**
 * "Did you mean …?" for the customer search (pattern 6).
 *
 * Deliberately tiny: the vocabulary is the app's OWN words — errand type
 * names, status labels, saved-address labels, recent searches — so a typo of
 * a word the app actually uses ("delivry", "cancled", "hmoe") gets corrected,
 * and nothing is ever suggested that the app doesn't know.
 */

/** Optimal-string-alignment distance (Levenshtein + adjacent swaps). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** How many edits a term of this length may be away and still count as a typo. */
function allowance(len: number): number {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  return 3;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The closest vocabulary entry to `query`, or null when nothing is close
 * enough (or the query already IS a vocabulary word). Whole phrases are
 * compared ("buy for mee" → "Buy for me"), and so are their single words
 * ("delivry" → "Delivery", "grocries" → nothing unless a phrase holds it).
 * Ties go to the earlier entry, so callers list their best words first.
 */
export function closestMatch(query: string, vocabulary: readonly string[]): string | null {
  const q = norm(query);
  if (q.length < 4) return null;
  let best: { term: string; dist: number } | null = null;
  const seen = new Set<string>();
  for (const raw of vocabulary) {
    const phrase = (raw ?? '').trim();
    if (!phrase) continue;
    const candidates = [phrase, ...phrase.split(/[\s/·,-]+/)];
    for (const cand of candidates) {
      const c = norm(cand);
      if (c.length < 3 || seen.has(c)) continue;
      seen.add(c);
      if (c === q) return null; // a real word, just with no results
      const dist = editDistance(q, c);
      if (dist <= allowance(Math.max(q.length, c.length)) && (!best || dist < best.dist)) {
        best = { term: cand.trim(), dist };
      }
    }
  }
  return best?.term ?? null;
}
