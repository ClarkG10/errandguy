import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * What the two SOS surfaces are allowed to SAY, and what they must never say.
 *
 * The panic button used to be a bare `api.post` with a dead-end toast: in a
 * basement car park the alert was silently lost and the person in danger was
 * told to "check your connection". Both surfaces now go through the durable
 * intent loop, and the honesty rules below are the load-bearing part —
 * they're the bit a future edit can quietly break without any test failing.
 *
 * The screens themselves can't be rendered here (map, router, socket, stores),
 * so the invariants are pinned against the source, as the sibling
 * tracking/cockpit suites already do.
 */
const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const readSrc = (...p: string[]) =>
  readFileSync(join(__dirname, '..', '..', ...p), 'utf8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TRACKING = read('(customer)', 'tracking', '[id].tsx');
const COCKPIT = read('(runner)', 'errand', '[id].tsx');
const SHEET = readSrc('components', 'safety', 'SosPendingSheet.tsx');
const TRACKING_CODE = stripComments(TRACKING);
const COCKPIT_CODE = stripComments(COCKPIT);
const SHEET_CODE = stripComments(SHEET);

describe('both surfaces raise SOS through the durable loop', () => {
  it('neither calls the raw trigger endpoint any more', () => {
    expect(TRACKING_CODE).not.toContain('bookingService.triggerSOS');
    expect(COCKPIT_CODE).not.toContain('runnerService.triggerSOS');
    expect(TRACKING_CODE).toContain("raiseSos(id, 'customer')");
    expect(COCKPIT_CODE).toContain("raiseSos(booking.id, 'runner')");
  });

  it('resumes a persisted intent on mount, so an app kill mid-press is recoverable', () => {
    expect(TRACKING_CODE).toContain('resumeSosIntent()');
    expect(COCKPIT_CODE).toContain('resumeSosIntent()');
  });

  it('flips to "active" when a BACKGROUND retry is the one that lands', () => {
    expect(TRACKING_CODE).toContain('if (!sosAck) return;');
    expect(COCKPIT_CODE).toContain('if (!sosAck) return;');
  });

  it('drops the queued intent BEFORE standing down — the one harmful replay', () => {
    // handleStandDown must call standDownSos first; a replay landing after
    // "I'm safe" would re-raise the alert the user just cancelled.
    const standDown = TRACKING_CODE.slice(
      TRACKING_CODE.indexOf('const handleStandDown'),
    ).slice(0, 900);
    expect(standDown.indexOf('standDownSos(id)')).toBeGreaterThan(-1);
    expect(standDown.indexOf('standDownSos(id)')).toBeLessThan(
      standDown.indexOf('bookingService.deactivateSOS(id)'),
    );
    expect(COCKPIT_CODE).toContain('standDownSos(id)');
  });
});

describe('the queued state never claims an alert was sent', () => {
  it('says "not sent yet" rather than showing the SOS-active card', () => {
    expect(TRACKING).toContain('SOS not sent yet');
    expect(SHEET).toContain('Alert not sent yet');
    // The active card stays gated on a server-acknowledged raise.
    expect(TRACKING_CODE).toContain('{!sosActive && !!queuedSos && (');
    expect(TRACKING_CODE).toContain('{sosActive && (');
  });

  it('offers the two things that work without data', () => {
    expect(SHEET_CODE).toContain("const EMERGENCY_NUMBER = '911'");
    expect(SHEET).toContain('Call 911');
    expect(SHEET_CODE).toContain('Linking.openURL(tel)');
    // Contacts come from the on-device cache, not a fetch we can't make.
    expect(TRACKING_CODE).toContain("AsyncStorage.getItem('@trusted_contacts_cache')");
    expect(COCKPIT_CODE).toContain("AsyncStorage.getItem('@trusted_contacts_cache')");
  });

  it('says the USER places the call — never that contacts were alerted', () => {
    // Whitespace-insensitive: the sentence wraps across JSX lines.
    const sheetText = SHEET.replace(/\s+/g, ' ');
    expect(sheetText).toContain('Tapping a contact places the call yourself');
    expect(sheetText).toContain('they haven’t been alerted');
    expect(SHEET_CODE).not.toMatch(/contacts (have been|were) (notified|alerted)/i);
  });

  it('keeps a manual retry and an explicit cancel in reach', () => {
    expect(SHEET).toContain('Try sending now');
    expect(SHEET).toContain('I’m safe — cancel this alert');
    expect(TRACKING_CODE).toContain('onRetry={retrySosNow}');
    expect(COCKPIT_CODE).toContain('onRetry={retrySosNow}');
  });

  it('is honest when a cancel lands on an alert that never left the phone', () => {
    expect(TRACKING).toContain('Alert cancelled — it was never sent');
    expect(COCKPIT).toContain('Alert cancelled — it was never sent');
  });
});

describe('neither surface promises a trusted-contact SMS the backend cannot send', () => {
  it('drops the SMS claim from the runner confirm (no provider is wired)', () => {
    // NotifySosContactsJob::notifySMSContact only logs a breadcrumb.
    expect(COCKPIT_CODE).not.toContain('live trip link via SMS');
    expect(COCKPIT_CODE).not.toContain('Emergency contacts notified');
    expect(COCKPIT).toContain('ErrandGuy safety is alerted immediately');
  });

  it('the customer surface still only claims contacts the SERVER listed', () => {
    expect(TRACKING_CODE).toContain('SOS sent to ErrandGuy support');
    expect(TRACKING_CODE).toContain('result.contacts');
  });
});

describe('the failure toast keeps the actionable half of the copy', () => {
  const SOS_INTENT = readSrc('services', 'sosIntent.ts');

  it('routes both surfaces through one honest describeSosFailure', () => {
    expect(TRACKING_CODE).toContain('describeSosFailure(');
    expect(COCKPIT_CODE).toContain('describeSosFailure(');
  });

  it('keeps "call for help directly" alive past the offline class copy', () => {
    // errorCatalog step 3 would otherwise replace the safety copy with
    // "check your connection and try again" — the least actionable sentence
    // you can hand someone in danger.
    expect(SOS_INTENT).toContain('preferFallback: true');
    expect(SOS_INTENT).toContain('copy.safety.sosFailed');
  });

  it('never shows a raw Laravel findOrFail message for a closed errand', () => {
    expect(SOS_INTENT).toContain('status === 404 || status === 403 || status === 422');
    expect(SOS_INTENT).toContain('Call 911 if you need help now');
  });
});
