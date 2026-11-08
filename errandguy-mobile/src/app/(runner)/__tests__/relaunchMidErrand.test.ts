import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A runner whose app restarted mid-errand stayed on the idle GPS profile until
 * they opened the errand: only an accept and the cockpit ever set the store's
 * current errand, which is what locationStore reads to pick the
 * navigation-grade profile. Home now seeds it from the server's current errand.
 *
 * Runner Home needs the map, location, realtime and a dozen services to render,
 * so its wiring is pinned against the source (as trackingCancelAndLoadError
 * does for the tracking screen).
 */
const HOME = readFileSync(join(__dirname, '..', '(tabs)', 'index.tsx'), 'utf8');
const seed = HOME.slice(
  HOME.indexOf('const errandSeedCheckedRef'),
  HOME.indexOf('const lastSeenMatchIdRef'),
);

describe('runner Home — relaunched mid-errand', () => {
  it('seeds the store from the server’s current errand', () => {
    expect(seed).toContain('useRunnerStore.setState({ currentErrand: fresh })');
  });

  it('only from a fresh server answer, never an older cached copy', () => {
    expect(seed).toMatch(/if \(currentErrandQ\.updatedAt == null \|\| currentErrandQ\.isStale\) return;/);
  });

  it('once per mount — later, the accept, cockpit and realtime own the store', () => {
    // The ref is set before any decision, so a pre-completion copy still in
    // the query can never resurrect an errand the cockpit just cleared.
    const once = seed.indexOf('errandSeedCheckedRef.current = true');
    expect(once).toBeGreaterThan(-1);
    expect(once).toBeLessThan(seed.indexOf('useRunnerStore.setState'));
  });

  it('only an accepted, still-live errand — never a matched offer, never a finished one', () => {
    expect(seed).toMatch(/STATUS_RANK\[fresh\.status\] \?\? -1\) >= STATUS_RANK\.accepted/);
    expect(seed).toContain('isTerminalStatus(fresh.status)');
  });

  it('never replaces an errand the store already holds', () => {
    expect(seed).toContain('useRunnerStore.getState().currentErrand) return;');
  });

  it('the GPS profile follows the store errand (the thing being seeded)', () => {
    const location = readFileSync(join(__dirname, '..', '..', '..', 'stores', 'locationStore.ts'), 'utf8');
    expect(location).toMatch(/useRunnerStore\.getState\(\)\.currentErrand \? 'active' : 'idle'/);
  });
});
