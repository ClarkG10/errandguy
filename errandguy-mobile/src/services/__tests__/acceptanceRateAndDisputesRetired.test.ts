import fs from 'fs';
import path from 'path';

/**
 * Arch guard: the runner acceptance rate and the Disputes desk are gone.
 *
 * The acceptance rate is removed from the runner profile API, and the copy
 * built on it promised things matching never did (priority for accepting,
 * fewer offers for declining). The Disputes desk has no endpoints left. The
 * app behaves the same against an old and a new server only if it never reads
 * the field or calls the endpoints, so any source line that brings one back
 * fails here. ("acceptance window"/`matched_acceptance_timeout_seconds` — the
 * offer's accept-by time — is a different thing and stays.)
 */
const SRC = path.join(__dirname, '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
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

describe('acceptance rate and disputes stay retired', () => {
  it('scans the real source tree, so the checks below are not vacuous', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.map(rel)).toContain(path.join('app', '(runner)', '(tabs)', 'profile.tsx'));
  });

  it('nothing reads, types or mocks acceptance_rate', () => {
    expect(filesContaining(/acceptance_rate|acceptanceRate/)).toEqual([]);
  });

  it('no runner surface shows an "Acceptance" stat', () => {
    expect(filesContaining(/>\s*Acceptance\s*</)).toEqual([]);
    expect(filesContaining(/label="Acceptance"/)).toEqual([]);
  });

  it('no copy promises priority or penalties tied to rating or accepting', () => {
    expect(filesContaining(/priority errand assignments|ahead of runners who decline|pause new offers/i)).toEqual(
      [],
    );
  });

  it('no dispute endpoint, screen or type survives', () => {
    expect(filesContaining(/\/disputes?\b|DisputeTicket|disputeService/)).toEqual([]);
  });
});
