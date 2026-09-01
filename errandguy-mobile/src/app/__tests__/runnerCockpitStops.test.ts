import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Runner cockpit — multi-stop operability, the over-budget dead-end, and
 * screen-reader announcements.
 *
 * Rendering this ~2.8k-line screen under jest would mean standing up the map,
 * the router, the Reverb socket and every store, so — exactly as
 * trackingArrivalCue.test.ts does for the customer side — the invariants are
 * pinned against the source. They are the ones that quietly regress:
 *   • a stop list that drifts back inside the collapsed disclosure,
 *   • a tick that stops being offline-safe,
 *   • a "warn" that turns into a "block" on the final Complete,
 *   • an instruction that tells the runner to do something the API cannot do.
 */
const COCKPIT = readFileSync(
  join(__dirname, '..', '(runner)', 'errand', '[id].tsx'),
  'utf8',
);
const RECEIPT_MODAL = readFileSync(
  join(__dirname, '..', '..', 'components', 'runner', 'ReceiptCaptureModal.tsx'),
  'utf8',
);

/**
 * Strip comments before asserting on COPY or on JSX props — both files
 * deliberately document the behaviour they replaced, and a comment quoting the
 * old string must not read as the old string still shipping. Safe here: neither
 * file contains a `//` inside a string literal (no URLs).
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const COCKPIT_CODE = stripComments(COCKPIT);
const RECEIPT_CODE = stripComments(RECEIPT_MODAL);

/** The JSX inside the `detailsOpen &&` disclosure. */
const disclosure = (() => {
  const start = COCKPIT.indexOf('{detailsOpen && (');
  expect(start).toBeGreaterThan(-1);
  return COCKPIT.slice(start, COCKPIT.indexOf('</ScrollView>', start));
})();

/** The `handleToggleStop` body. */
const toggleStop = (() => {
  const start = COCKPIT.indexOf('const handleToggleStop = useCallback(');
  expect(start).toBeGreaterThan(-1);
  return COCKPIT.slice(start, COCKPIT.indexOf('\n  }, []);', start));
})();

describe('multi-stop is driven, not just displayed', () => {
  it('renders the stop list in the sheet primary column, not the disclosure', () => {
    // Rendered in BOTH slots of the scroll area (above the customer pill while
    // the runner is running the stops, below it beforehand)…
    expect(COCKPIT).toContain('{stopsInPrimarySlot ? stopsSection : null}');
    expect(COCKPIT).toContain('{stopsInPrimarySlot ? null : stopsSection}');
    // …and never again inside the collapsed "Trip details" disclosure, which
    // defaults closed and is where the stops used to be unreachable.
    expect(disclosure).not.toContain('booking.stops');
    expect(disclosure).not.toContain('<StopRow');
  });

  it('gives every stop a Navigate and a Call the row itself owns', () => {
    const row = COCKPIT.slice(
      COCKPIT.indexOf('function StopRow({'),
      COCKPIT.indexOf('export default function ActiveErrandScreen'),
    );
    expect(row).toMatch(/onNavigate\(stop\)/);
    expect(row).toMatch(/onCall\(stop\)/);
    // Navigate goes through the shared external-nav handoff (which honours the
    // runner's remembered Waze-vs-Maps choice), not a hand-rolled maps URL.
    expect(COCKPIT).toMatch(/handleStopNavigate[\s\S]{0,600}launchExternalNav/);
    expect(COCKPIT).toMatch(/handleStopNavigate[\s\S]{0,600}normalizeCoords/);
    expect(row).not.toMatch(/maps\.apple\.com|google\.com\/maps|waze/i);
    // Call dials the stop's OWN contact, never the booking customer's number.
    expect(COCKPIT).toMatch(
      /handleStopCall[\s\S]{0,400}stop\.contact_phone[\s\S]{0,400}tel:/,
    );
  });

  it('ticks a stop through the offline queue, scoped to that stop', () => {
    expect(toggleStop).toContain("queueable(\n      'runner.completeStop',");
    expect(toggleStop).toContain('runOptimistic({');
    // Per-STOP dedupe: three toggles of one stop coalesce, and one stop can
    // never supersede a sibling's queued tick.
    expect(toggleStop).toMatch(/dedupeKey: `stop-\$\{cur\.id\}-\$\{stop\.id\}`/);
    // Rollback restores THIS stop's previous stamp, not a whole-list snapshot.
    expect(toggleStop).toMatch(/rollback: \(\) => patchStop\(stop\.completed_at \?\? null\)/);
    // Reconciles to server truth once the queued tick lands (or is dropped).
    expect(toggleStop).toContain("invalidate: [['runner', 'errand', 'byId', cur.id]]");
  });

  it('WARNS on the final Complete tap with unticked stops — never blocks', () => {
    const gate = COCKPIT.slice(
      COCKPIT.indexOf("if (nextStatus === 'completed' && !stopWarningAckRef.current)"),
      COCKPIT.indexOf('// Shopping errands: capture receipt'),
    );
    expect(gate).toContain('setShowStopWarning(true)');
    // The gate only fires when something is actually unvisited…
    expect(gate).toContain('.filter(\n        (stop) => !stop.completed_at,\n      )');
    // …and the modal's confirm re-enters the SAME handler, so the runner is
    // never trapped on an errand a closed gate stopped them finishing.
    expect(COCKPIT).toContain('confirmLabel="Complete anyway"');
    expect(COCKPIT).toMatch(
      /stopWarningAckRef\.current = true;\s*\n\s*setShowStopWarning\(false\);\s*\n\s*void handleStatusUpdate\(\);/,
    );
    // Naming them is the whole point — a bare "some stops are unticked" tells
    // the runner nothing they can act on.
    expect(COCKPIT).toContain('`Stop ${stop.sequence}: ${stop.address}`');
  });

  it('offers ticking only once the runner is actually running the stops', () => {
    expect(COCKPIT).toMatch(
      /const canTickStops =[\s\S]{0,240}STOP_PHASE_STATUSES\.has\(booking\.status\)[\s\S]{0,120}!isReadOnly/,
    );
  });
});

describe('over-budget basket: the instruction matches what the app can do', () => {
  it('no longer tells the runner to have the customer add funds', () => {
    // `shopping_budget` has exactly one writer in the whole API (booking
    // creation) — there is no screen and no endpoint that can raise it, so
    // this instruction sent a runner standing at the till into nothing.
    expect(RECEIPT_CODE).not.toMatch(/add funds/i);
    expect(RECEIPT_CODE).toContain("The budget can&apos;t be raised in the app");
  });

  it('hands the runner two exits that exist', () => {
    expect(RECEIPT_MODAL).toContain('onMessageCustomer');
    expect(RECEIPT_MODAL).toContain('onReportIssue');
    // Both are wired from the cockpit to real destinations.
    expect(COCKPIT).toMatch(/onMessageCustomer=\{\(\) => \{[\s\S]{0,200}\/\(runner\)\/chat\//);
    expect(COCKPIT).toMatch(/onReportIssue=\{\(\) => \{[\s\S]{0,200}setShowIssueSheet\(true\)/);
  });

  it('still refuses to submit over budget — the server would 422 it anyway', () => {
    expect(RECEIPT_MODAL).toContain('const canSubmit = amount > 0 && !overBudget');
  });
});

describe('screen-reader operability', () => {
  it('makes the step hero one header-role jump target', () => {
    expect(COCKPIT).toMatch(
      /accessible\s*\n\s*accessibilityRole="header"\s*\n\s*accessibilityLabel=\{\[/,
    );
    // The collapsed group must still carry the ETA, or grouping would LOSE it.
    expect(COCKPIT).toMatch(/\$\{Math\.max\(1, Math\.round\(etaMin\)\)\} minutes away/);
  });

  it('announces a step change exactly once, off a single derived-status ref', () => {
    const effect = COCKPIT.slice(
      COCKPIT.indexOf('const announcedStatusRef'),
      COCKPIT.indexOf('const customerPhone ='),
    );
    expect(effect).toContain('if (announcedStatusRef.current === status) return;');
    // First resolved status is not announced — the reader is already reading
    // the screen the runner just opened — and Android is left to the live
    // region, or it would hear the whole step twice.
    expect(effect).toContain("if (isFirst || Platform.OS !== 'ios') return;");
    expect(effect).toContain('AccessibilityInfo.announceForAccessibility(');
    expect(effect).toMatch(/\}, \[booking\?\.status\]\);/);
  });

  it('puts the live region on the beads, never around the live ETA', () => {
    // Exactly one live region on the screen, and it wraps <JourneyBeads> —
    // whose label changes only when the STEP does. Around the hero it would
    // re-announce every GPS fix (~6-10s) while the runner is driving.
    expect(COCKPIT_CODE.match(/accessibilityLiveRegion/g)).toHaveLength(1);
    expect(COCKPIT).toMatch(
      /accessibilityLiveRegion="polite"[\s\S]{0,200}<JourneyBeads/,
    );
    // The announced string must stay ETA-free.
    const announcement = COCKPIT.slice(
      COCKPIT.indexOf('const stepAnnouncement = ['),
      COCKPIT.indexOf(".join('. ');", COCKPIT.indexOf('const stepAnnouncement = [')),
    );
    expect(announcement).not.toMatch(/eta/i);
    expect(announcement).toContain('stepPositionLabel');
    expect(announcement).toContain('runnerHeroTitle');
  });

  it('labels the payout strip as a single node', () => {
    expect(COCKPIT).toMatch(/accessibilityLabel=\{\[\s*\n\s*booking\.runner_payout != null/);
  });
});
