import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * runner_id is set when an errand is OFFERED, before anyone accepts. Tracking
 * keyed the runner card and "Report this person" on runner_id alone, so while
 * the offer waited — and on an errand cancelled before anyone accepted — the
 * customer saw "On the way · Call · Message" for a "?" runner, and a report
 * link with nobody behind it. Pinned against the source (tracking can't be
 * rendered under jest).
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const TRACKING = stripComments(
  readFileSync(join(__dirname, '..', '(customer)', 'tracking', '[id].tsx'), 'utf8'),
);

describe('tracking shows a runner only once one accepted', () => {
  it('derives that from the acceptance, not from the offer', () => {
    expect(TRACKING).toMatch(
      /const runnerTookIt =\s*!!booking\.runner_id &&\s*\(!!booking\.accepted_at \|\|\s*!\['pending', 'matched', 'no_runner', 'cancelled'\]\.includes\(booking\.status\)\);/,
    );
  });

  it('gates the runner card and the report link on it', () => {
    expect(TRACKING).toContain('const runnerCard = runnerTookIt ? (');
    expect(TRACKING).toMatch(/\{runnerTookIt \? \(\s*<Pressable[\s\S]{0,400}setShowReportUser\(true\)/);
    expect(TRACKING).not.toMatch(/\{booking\.runner_id \? \(\s*<Pressable[\s\S]{0,400}setShowReportUser/);
  });
});
