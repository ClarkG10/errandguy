import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The runner's day, walked end to end — first shift, waiting, the job, the
 * money. These screens can't be rendered under jest (maps, router, sockets,
 * half a dozen stores), so — like runnerStatusBlindness / runnerCockpitStops —
 * the fixes are pinned against the source. Each assertion names a detour or a
 * wrong number a runner actually hit.
 */
const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const HOME = stripComments(read('(runner)', '(tabs)', 'index.tsx'));
const LAYOUT = stripComments(read('(runner)', '_layout.tsx'));
const COCKPIT_RAW = read('(runner)', 'errand', '[id].tsx');
const COCKPIT = stripComments(COCKPIT_RAW);
const NAVIGATE = stripComments(read('(runner)', 'navigate', '[id].tsx'));
const HISTORY = stripComments(read('(runner)', '(tabs)', 'history.tsx'));
const EARNINGS = stripComments(read('(runner)', '(tabs)', 'earnings.tsx'));
const TABS = stripComments(read('(runner)', '(tabs)', '_layout.tsx'));

describe('a locked phone no longer ends the shift silently', () => {
  it('Home keeps the screen on while online and waiting, behind a remembered switch', () => {
    expect(HOME).toContain(
      "useKeepAwakeWhile(isOnline && !activeErrand && keepAwakeWaiting, 'runner-home-waiting')",
    );
    expect(HOME).toContain('Keep screen on while waiting');
    expect(HOME).toContain('`@eg_runner_keep_awake:${userId}`');
    // Default on: only an explicit "off" turns it off.
    expect(HOME).toContain("setKeepAwakeWaiting(v !== 'off')");
  });

  it('the runner group schedules the "open the app" reminder while idle and online', () => {
    expect(LAYOUT).toContain('useRunnerIdleReminder(isOnline && !onErrand)');
  });
});

describe('the first shift after approval', () => {
  it('asks for a vehicle BEFORE the GPS wait, and no longer detours to errand types', () => {
    const toggle = HOME.slice(HOME.indexOf('const handleToggleOnline'));
    const vehicleCheck = toggle.indexOf('!cachedProfile.vehicle_type');
    const gpsWait = toggle.indexOf('getCurrentCoords(');
    expect(vehicleCheck).toBeGreaterThan(-1);
    expect(vehicleCheck).toBeLessThan(gpsWait);
    expect(toggle.slice(0, gpsWait)).not.toContain('preferred_types');
  });

  it('a runner waiting on approval sees what they can set up now', () => {
    expect(HOME).toContain('Before your first shift');
    for (const route of [
      '/(runner)/settings/documents',
      '/(runner)/settings/vehicle',
      '/(runner)/settings/preferred-types',
    ]) {
      expect(HOME).toContain(`route: '${route}'`);
    }
  });

  it('the location nudge says what is really at stake', () => {
    expect(HOME).not.toContain('Customers can&apos;t see you on the map without it.');
    // Offline: what they can't do. Already online: what they're missing, and
    // the 30-minute switch-off — "can't go online" was untrue for them.
    expect(HOME).toContain('Without it you can’t go online or get errands.');
    expect(HOME).toContain('Without it you won’t get errands, and you go offline after 30 minutes.');
    // And the caption beside it no longer says "receiving requests".
    expect(HOME).toContain("isOnline && locationGranted === false\n    ? 'Online · turn on location to get requests'");
  });

  it('warns before the cash-debt ceiling, not only after', () => {
    expect(HOME).toContain('cash_debt_warning');
    expect(HOME).toContain('Close to the cash limit');
  });
});

describe('the power button mid-errand', () => {
  it('explains instead of flipping offline and failing', () => {
    const toggle = HOME.slice(HOME.indexOf('const handleToggleOnline'));
    const guard = toggle.indexOf('if (!value && activeErrand) {');
    expect(guard).toBeGreaterThan(-1);
    // Before the optimistic flip, so nothing changes on screen.
    expect(guard).toBeLessThan(toggle.indexOf('runOptimistic('));
    expect(HOME).toContain('accessibilityState={{ busy: togglingOnline, disabled: offlineLocked }}');
  });
});

describe('the offer', () => {
  it('a cold-start push tap onto the errand screen still gets the countdown + Decline', () => {
    expect(COCKPIT).toContain("if (!fresh || fresh.status !== 'matched') return;");
    expect(COCKPIT).toContain('if (store.isOfferDeclined(fresh.id)) return;');
    expect(COCKPIT).toContain(
      'store.setIncomingRequest({ booking: fresh, expiresAt: offerExpiresAt(deadline) });',
    );
  });

  it('accepting over that screen does not push a second copy; declining leaves it', () => {
    expect(LAYOUT).toContain('if (!isOnOfferScreen(offer.id)) router.push(');
    expect(LAYOUT).toContain("if (isOnOfferScreen(offer.id)) router.replace('/(runner)/(tabs)' as any);");
  });
});

describe('fewer taps on the job', () => {
  it('each leg opens the navigation app the runner chose', () => {
    expect(COCKPIT).toContain('void launchExternalNav(preferredNavApp, false, dest);');
    // ...and waits to know the choice before guessing.
    expect(COCKPIT).toContain('if (!navPrefLoaded) return;');
  });

  it('"I\'ve Arrived" in the navigator is one tap', () => {
    expect(NAVIGATE).toContain('onPress={handleArrivedTap}');
    const tap = NAVIGATE.slice(NAVIGATE.indexOf('const handleArrivedTap'));
    expect(tap.slice(0, tap.indexOf('};'))).toContain('void handleConfirmArrived();');
  });

  it('the receipt upload is visible and holds the next step until it lands', () => {
    expect(COCKPIT).toContain('loading={loading || submittingReceipt}');
    // Raw source: a comment mentioning `support/*` upstream of this handler
    // fools the naive comment stripper into eating it.
    expect(COCKPIT_RAW).toContain('if (submittingReceipt) return;');
    expect(COCKPIT).toContain("'Uploading receipt'");
    expect(COCKPIT).toContain('(frac) => setUploadProgress(frac)');
  });
});

describe('reaching people and finishing the handover', () => {
  it('calls the current leg first and offers the others', () => {
    expect(COCKPIT).toContain('? [pickup, customer, dropoff]');
    expect(COCKPIT).toContain(': [dropoff, customer, pickup];');
    expect(COCKPIT).toContain('Other numbers');
  });

  it('the completion sheet repeats the cash, and allows a no-signature finish only on a photo with nothing to collect', () => {
    expect(COCKPIT).toContain('collectAmount={amountToCollect}');
    expect(COCKPIT).toContain('canSkipSignature={!!(booking.delivery_photo_url || deliveryPhotoUrl) && amountToCollect == null}');
    expect(COCKPIT).toContain('noSignatureReason: sig ? null : noSignature?.reason ?? null,');
  });

  it('the SOS confirm that says "call 911" can call 911', () => {
    expect(COCKPIT).toContain('onPress={() => dialNumber(EMERGENCY_NUMBER)}');
  });
});

describe('money that adds up', () => {
  it('History and Home show what a cancelled errand actually paid', () => {
    expect(HISTORY).toContain('earnedLabel(item)');
    expect(HOME).toContain('{earnedLabel(errand)}');
  });

  it('Earnings splits cash in hand from wallet money and marks each row', () => {
    expect(EARNINGS).toContain('cash already in hand');
    expect(EARNINGS).toContain('paid online');
    expect(EARNINGS).toContain("how === 'cash' ? 'Cash' : how === 'online' ? 'Paid online' : null");
  });
});

describe('copy', () => {
  it('the tab bar names its tabs', () => {
    expect(TABS).toContain('tabBarShowLabel: true');
  });

  it('review times say 1–2 business days everywhere', () => {
    expect(read('(runner)', 'settings', 'help.tsx')).not.toContain('24-48 hours');
    expect(read('(runner)', 'settings', 'help.tsx')).toContain('within 1–2 business days');
    expect(read('(runner)', 'onboarding.tsx')).toContain('1–2 business days');
  });

  it('a repeat runner is not told about their "first payout"', () => {
    expect(stripComments(read('(runner)', 'payout', 'index.tsx'))).not.toContain(
      'to your first payout',
    );
  });

  it('vehicle documents are not called required', () => {
    for (const src of [read('(runner)', 'onboarding.tsx'), read('(runner)', 'settings', 'documents.tsx')]) {
      expect(src).not.toMatch(/Required if you(’|')?(ll)? use a motorcycle or car/);
    }
  });

  it('notification settings describe direct offers, not open ones', () => {
    const src = read('(runner)', 'settings', 'notifications.tsx');
    expect(src).not.toContain('up for grabs');
  });

  it('account deletion says what is deleted and what the law makes us keep', () => {
    expect(read('(runner)', '(tabs)', 'profile.tsx')).toContain(
      "This can't be undone. Your name, contact details, ID documents, selfie and saved payout details are deleted. Records of past errands, earnings and payouts are kept, without your contact details, because the law requires us to keep financial records — a payout record keeps the account it was sent to. The full list is on our account-deletion page.",
    );
  });
});
