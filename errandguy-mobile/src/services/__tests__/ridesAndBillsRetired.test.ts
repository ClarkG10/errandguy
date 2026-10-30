import fs from 'fs';
import path from 'path';

/**
 * Arch guard: passenger rides and Bills Payment are retired, and errand types
 * went from ten to four.
 *
 * Old bookings still carry the retired slugs, so exactly one module resolves
 * them (constants/errandTypeRules: legacy aliases + the legacy bill-payment
 * flow). Everything else must stay type-agnostic and never depend on the ride
 * fields the server may stop sending (`ride_pin`, `is_transportation`) or on
 * the removed PIN endpoint — a ride still in progress finishes on the normal
 * delivery steps instead.
 */
const SRC = path.join(__dirname, '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__') continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(SRC);
const rel = (file: string) => path.relative(SRC, file);
const read = (...parts: string[]) => fs.readFileSync(path.join(SRC, ...parts), 'utf8');
const filesContaining = (pattern: RegExp) =>
  files.filter((f) => pattern.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();

describe('rides and Bills Payment stay retired', () => {
  it('scans the real source tree, so the checks below are not vacuous', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.map(rel)).toContain(path.join('app', '(runner)', 'errand', '[id].tsx'));
  });

  it('never calls the ride PIN endpoint or reads the ride fields', () => {
    expect(filesContaining(/verify-pin|verifyRidePin/)).toEqual([]);
    expect(filesContaining(/ride_pin|is_transportation/)).toEqual([]);
  });

  it('names the retired ride and bill slugs only where old bookings are resolved', () => {
    expect(filesContaining(/\btransportation\b|\bbills_payment\b/)).toEqual(
      [
        // Old ride bookings still draw their own illustration.
        path.join('components', 'ui', 'ErrandTypeIcon.tsx'),
        // The legacy aliases and the legacy bill-payment flow.
        path.join('constants', 'errandTypeRules.ts'),
      ].sort(),
    );
  });

  it('sends a draft for a retired type back to the picker from every later step', () => {
    for (const step of ['details', 'schedule', 'review']) {
      expect(read('app', '(customer)', 'book', `${step}.tsx`)).toMatch(
        /useRetiredErrandTypeGuard\(\);/,
      );
    }
  });
});
