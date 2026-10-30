import fs from 'fs';
import path from 'path';

/**
 * Arch guard: no prefetch may warm a key nothing reads.
 *
 * The whole preload layer is invisible when it's wrong. A seed written to
 * `['runner','errand', id]` when the cockpit reads
 * `['runner','errand','byId', id]` costs a request, warms nothing, and looks
 * perfectly healthy in review — and the screen still spins. That failure has a
 * track record in this codebase: a push gate keyed on a proxy condition, a
 * `clearMutationQueue` with zero callers, a documented seed for a key the
 * screens had since renamed.
 *
 * So this compares, mechanically, what the preload layer WRITES against what
 * the screens READ, and fails on a seed nobody consumes.
 *
 * The reverse direction — a screen whose query is never warmed — is reported
 * for information only, never asserted: plenty of screens are legitimately
 * cold (rarely visited, or cheap enough not to bother), and forcing a prefetch
 * for each would be exactly the "features for features' sake" this project
 * keeps refusing.
 */
const SRC = path.join(__dirname, '..', '..');

const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** Two-segment key prefixes, e.g. "runner/errand" or "errand-types". */
function keyPrefixes(source: string, pattern: RegExp): Set<string> {
  const out = new Set<string>();
  for (const m of source.matchAll(pattern)) {
    const a = m[1];
    const b = m[2];
    out.add(b ? `${a}/${b}` : a);
  }
  return out;
}

/** Walk every screen/component file and collect the useQuery keys they read. */
function readKeys(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const s = fs.readFileSync(full, 'utf8');
      if (!s.includes('useQuery')) continue;
      for (const k of keyPrefixes(
        s,
        /useQuery[^(]*\(\s*\[\s*'([a-z0-9_-]+)'\s*(?:,\s*'([a-z0-9_-]+)')?/g,
      )) {
        out.add(k);
      }
    }
  };
  walk(path.join(SRC, 'app'));
  walk(path.join(SRC, 'components'));
  walk(path.join(SRC, 'hooks'));
  return out;
}

/** Every non-test source file under the given top-level src directories. */
function sourceFiles(dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  for (const d of dirs) walk(path.join(SRC, d));
  return out;
}

/**
 * Keys the preload layer writes. Both shapes it uses: `seed([...])` for the
 * per-endpoint warms and `write([...])` for the aggregate snapshot.
 */
function warmedKeys(): Set<string> {
  const pre = read('services/preload.service.ts');
  return new Set([
    ...keyPrefixes(pre, /\bseed\(\s*\[\s*'([a-z0-9_-]+)'\s*(?:,\s*'([a-z0-9_-]+)')?/g),
    ...keyPrefixes(pre, /\bwrite\(\s*\[\s*'([a-z0-9_-]+)'\s*(?:,\s*'([a-z0-9_-]+)')?/g),
  ]);
}

describe('prefetch coverage', () => {
  const consumed = readKeys();
  const warmed = warmedKeys();

  it('found both sides, so the comparison is not vacuous', () => {
    // A regex that silently stops matching would make every assertion below
    // pass forever while checking nothing.
    expect(warmed.size).toBeGreaterThan(8);
    expect(consumed.size).toBeGreaterThan(15);
  });

  it('warms no key that no screen reads', () => {
    const dead = [...warmed].filter((k) => !consumed.has(k)).sort();

    expect(dead).toEqual([]);
  });

  /**
   * The three keys this pass found cold and wired up. Pinned by name because
   * each was a real, measured wait: the customer's active-errand LIST is read
   * by Home, Profile and (customer)/_layout — the most-hit surface in the app.
   */
  it('warms the keys the highest-traffic surfaces depend on', () => {
    for (const key of [
      'bookings/active-list',
      'booking/active',
      'bookings/recent',
      'errand-types',
      'runner/profile',
      'runner/errand',
      'support/tickets',
      'runner/heatmap',
      'runner/wallet',
    ]) {
      expect([...warmed]).toContain(key);
    }
  });

  /**
   * Promo codes are retired: the Promos screen, the Review chips and the Home
   * pill that read `['promos', userId]` are gone, and so are the warms that
   * fed them. Pinned on both sides so a revived reader or seed shows up here.
   */
  it('neither warms nor reads the retired promos key', () => {
    expect(warmed.has('promos')).toBe(false);
    expect(consumed.has('promos')).toBe(false);
  });

  /**
   * The runner's open-offers list is retired with "name your price": every
   * offer is a direct one, raised by the offer modal. Its key
   * `['runner','errand','available', userId]` shares the two-segment prefix
   * `runner/errand` with the live current-errand and cockpit keys, so the
   * prefix checks above cannot see it — pin the full key on both sides, plus
   * the endpoint that fed it.
   */
  it('neither warms nor reads the retired runner open-offers key', () => {
    const retiredKey = /\[\s*'runner'\s*,\s*'errand'\s*,\s*'available'/;
    const files = sourceFiles(['app', 'components', 'hooks', 'services', 'stores']);
    expect(files.length).toBeGreaterThan(100);

    const offenders = files
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8');
        return retiredKey.test(src) || src.includes('/runner/errand/available');
      })
      .map((f) => path.relative(SRC, f));

    expect(offenders).toEqual([]);
    // The live half of that prefix is still warmed, so the check above is
    // looking at a key family that exists.
    expect(warmed.has('runner/errand')).toBe(true);
  });
});
