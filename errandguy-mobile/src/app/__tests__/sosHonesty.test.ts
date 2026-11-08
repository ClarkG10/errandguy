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
const CARD = readSrc('components', 'safety', 'SosActiveCard.tsx');
const EMERGENCY = readSrc('components', 'safety', 'emergency.ts');
const TRACKING_CODE = stripComments(TRACKING);
const COCKPIT_CODE = stripComments(COCKPIT);
const SHEET_CODE = stripComments(SHEET);
const CARD_CODE = stripComments(CARD);

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

  it('also resumes from the root, on sign-in and on every return to the foreground', () => {
    // After a kill the person may never reopen the errand screen, and iOS
    // pauses the retry timer in the background — so the root picks it up.
    const ROOT = stripComments(read('_layout.tsx'));
    const effect = ROOT.slice(ROOT.indexOf('void resumeSosIntent();')).slice(0, 300);
    expect(ROOT).toContain('if (isLoading || !isAuthenticated) return;');
    expect(effect).toMatch(/if \(state === 'active'\) void resumeSosIntent\(\);/);
  });

  it('the pending sheet promises only what the retry loop really does', () => {
    const sheetText = SHEET.replace(/\s+/g, ' ');
    expect(sheetText).not.toContain('even if you close the app');
    expect(SHEET).not.toContain('Keep trying in the background');
    expect(sheetText).toContain('Keep ErrandGuy open');
    expect(sheetText).toContain('tries again the next time you open it');
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
    // The active card stays gated on a server-acknowledged raise: it renders
    // from the per-errand record sosIntent writes on the ack, never from a
    // queued intent.
    expect(TRACKING_CODE).toContain('{!sosActive && !!queuedSos && (');
    expect(TRACKING_CODE).toContain('{sosActive && sosRecord && (');
    expect(TRACKING_CODE).toContain('const sosRecord = useSosActive(id);');
    expect(TRACKING_CODE).toContain('const sosActive = !!sosRecord && !sosRecord.resolvedAt;');
  });

  it('offers the two things that work without data', () => {
    expect(EMERGENCY).toContain("export const EMERGENCY_NUMBER = '911'");
    expect(EMERGENCY).toContain('Linking.openURL(tel)');
    expect(SHEET_CODE).toContain('dialNumber(EMERGENCY_NUMBER)');
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

describe('neither surface promises more than the server says happened', () => {
  it('the runner confirm claims only staff + location, nothing about contacts or the customer', () => {
    // Trusted contacts are texted only when the server has SMS set up, and the
    // other person on the errand is no longer alerted automatically — neither
    // is the app's to promise before the fact.
    expect(COCKPIT_CODE).not.toContain('live trip link via SMS');
    expect(COCKPIT_CODE).not.toContain('Emergency contacts notified');
    expect(COCKPIT_CODE).not.toContain('the customer is notified');
    expect(COCKPIT_CODE).toContain('This alerts the ErrandGuy safety team');
  });

  it('neither confirm claims support "has your live location"', () => {
    for (const code of [TRACKING_CODE, COCKPIT_CODE]) {
      expect(code).not.toMatch(/with your live location/);
      expect(code).toContain('current location if it’s available');
      expect(code).toContain('call 911');
    }
  });

  it('the sent toast repeats who the SERVER says it alerted', () => {
    // Both surfaces show the server's sentence alone — it already says the
    // alert went out ("SOS sent. SOS sent to…" read twice).
    expect(TRACKING_CODE).toContain('toast.success(sosAlertedText(result))');
    expect(TRACKING_CODE).not.toContain('toast.success(`SOS sent. ${sosAlertedText(result)}`)');
    // The runner cockpit shows the server's sentence alone — it already says
    // the alert went out ("SOS sent. SOS sent to…" read twice).
    expect(COCKPIT_CODE).toContain('toast.success(sosAlertedText(result))');
    expect(COCKPIT_CODE).not.toContain('toast.success(`SOS sent. ${sosAlertedText(result)}`)');
  });

  // The rule above was correct and was still defeated end-to-end: the SERVER
  // pre-filled `contacts_notified` with every trusted contact the instant the
  // alarm was pulled, before any delivery was attempted, so "only claim what
  // the server listed" resolved to claiming everyone. SOSService no longer
  // writes that field (NotifySosContactsJob fills it on confirmed delivery
  // only), and these pin the two customer-facing sentences that were wrong.
  it('the customer confirm never says trusted contacts get alerted', () => {
    expect(TRACKING_CODE).not.toContain(
      'alerts ErrandGuy support and your trusted contacts',
    );
    expect(TRACKING_CODE).toContain(
      'puts your trusted contacts one tap away to call',
    );
  });

  it('BOTH live surfaces render the shared card: 911, tap-to-call contacts, "I\'m safe"', () => {
    expect(TRACKING_CODE).toContain('<SosActiveCard');
    expect(COCKPIT_CODE).toContain('<SosActiveCard');
    expect(CARD_CODE).toContain('dialNumber(EMERGENCY_NUMBER)');
    expect(CARD_CODE).toContain('dialNumber(c.phone)');
    expect(CARD_CODE).toContain('label="I’m safe — cancel alert"');
    // Who it reached comes from the server's own sentence, never a guess.
    expect(CARD_CODE).toContain('if (record.alertedLine) return record.alertedLine;');
  });

  it('the trusted-contacts screen does not promise we notify them', () => {
    // Shared by both apps now; the route files are thin wrappers.
    const CONTACTS = readSrc('components', 'safety', 'TrustedContactsScreen.tsx');
    const CONTACTS_CODE = stripComments(CONTACTS);
    expect(CONTACTS_CODE).not.toContain('to be notified during emergencies');
    expect(CONTACTS_CODE).not.toContain('called first during SOS emergencies');
    expect(CONTACTS_CODE).toContain('Don’t count on ErrandGuy to message them');
    expect(read('(customer)', 'trusted-contacts', 'index.tsx')).toContain('<TrustedContactsScreen');
    expect(read('(runner)', 'settings', 'trusted-contacts.tsx')).toContain('<TrustedContactsScreen');
  });
});

describe('the SOS-active card survives leaving and reopening the screen', () => {
  it('both surfaces hydrate the per-errand records on mount', () => {
    expect(TRACKING_CODE).toContain('void hydrateSosActive();');
    expect(COCKPIT_CODE).toContain('void hydrateSosActive();');
  });

  it('only this device\'s successful stand-down removes the record', () => {
    // Cleared AFTER the DELETE lands (or when nothing was ever sent) — a failed
    // stand-down must leave the card, and "I'm safe", on screen.
    for (const code of [TRACKING_CODE, COCKPIT_CODE]) {
      const standDown = code.slice(code.indexOf('const handleStandDown'));
      const del = standDown.search(/(bookingService|runnerService)\.deactivateSOS\(id\)/);
      expect(del).toBeGreaterThan(-1);
      expect(standDown.indexOf('clearSosActive(id)')).toBeGreaterThan(del);
    }
  });

  it('both surfaces reconcile against fresh server reads and show a staff close', () => {
    expect(TRACKING_CODE).toContain('reconcileSosActive(id, b?.sos_triggered)');
    expect(COCKPIT_CODE).toContain('reconcileSosActive(id, fresh.sos_triggered)');
    expect(TRACKING_CODE).toContain('<SosResolvedNotice');
    expect(COCKPIT_CODE).toContain('<SosResolvedNotice');
  });

  it('the runner never mistakes the CUSTOMER\'s alert for their own', () => {
    // booking.sos_triggered is set by either side's alert.
    expect(COCKPIT_CODE).not.toContain('if (booking?.sos_triggered) setSosActive(true)');
    expect(COCKPIT_CODE).toContain('const sosRecord = useSosActive(id);');
  });

  it('the runner can stand down their own sent SOS, from the top bar or the banner', () => {
    expect(COCKPIT_CODE).toContain('onStandDown={handleStandDown}');
    expect(COCKPIT_CODE).toContain("'SOS active — open emergency options'");
    expect(COCKPIT_CODE).not.toContain("'SOS already triggered'");
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

describe("the customer's SOS button", () => {
  it('is on every live errand with or without a runner — only an unpaid one hides it', () => {
    // Staff can take a runner off an accepted errand (return to matching,
    // e.g. after the customer complained about them). Gating the button on a
    // runner being assigned removed the customer's only SOS entry point then.
    const code = stripComments(TRACKING);
    const at = code.indexOf('title="Emergency SOS"');
    expect(at).toBeGreaterThan(-1);
    const condition = code.slice(code.lastIndexOf('{', code.lastIndexOf('&& (', at)), at);
    expect(condition).toMatch(/isLiveBooking/);
    expect(condition).toMatch(/!awaitingPayment/);
    expect(condition).not.toMatch(/runner_id/);
  });
});
