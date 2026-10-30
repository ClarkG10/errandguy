import fs from 'fs';
import path from 'path';

/**
 * Arch guard: promo codes are retired, and the app must never ask for them.
 *
 * During the rollout this build can meet either server: the one that still
 * serves GET /promos and GET /promos/validate/{code} and still reads
 * `promo_code` on POST /bookings, or the one that has none of them. It only
 * behaves the same against both if it never calls those endpoints and never
 * sends the field, so this fails on any source line that brings one back.
 *
 * The one deliberate `promo_code` left is the booking store's list of retired
 * draft fields, which exists to strip it from drafts an older build saved.
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
const filesContaining = (pattern: RegExp) =>
  files.filter((f) => pattern.test(fs.readFileSync(f, 'utf8'))).map(rel);

describe('promo codes stay retired', () => {
  it('scans the real source tree, so the checks below are not vacuous', () => {
    // A walk that silently found nothing would pass every assertion below.
    expect(files.length).toBeGreaterThan(100);
    expect(files.map(rel)).toContain(path.join('app', '(customer)', 'book', 'review.tsx'));
  });

  it('never calls a promo endpoint or routes to the removed Promos screen', () => {
    expect(filesContaining(/\/promos\b/)).toEqual([]);
    expect(fs.existsSync(path.join(SRC, 'app', '(customer)', 'promos.tsx'))).toBe(false);
  });

  it('never sends promo_code — only the store mentions it, to strip old drafts', () => {
    expect(filesContaining(/promo_code/)).toEqual([path.join('stores', 'bookingStore.ts')]);
  });
});
