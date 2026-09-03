import fs from 'fs';
import path from 'path';
import { useNotificationStore } from '../notificationStore';

/**
 * "Online and ready for errands" has to be TRUE.
 *
 * Push registration used to `return null` on a denied permission and record
 * nothing. A push is the only channel that reaches a phone in a pocket, so a
 * runner who denied notifications could go online, be told they were ready,
 * and never hear about a single offer — concluding there was no work, or that
 * the app was broken. The denial was invisible to the app and unrecoverable
 * from inside it.
 *
 * The store slice is real behaviour and tested as such; the two wiring points
 * are guarded by source shape, since neither the Expo permission API nor a
 * toast can be exercised here.
 */
const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

describe('pushPermission store slice', () => {
  it('starts unknown, so nothing warns before registration has run', () => {
    // Warning on an unknown is worse than staying quiet — it would fire on
    // every cold start before the permission check completes.
    expect(useNotificationStore.getState().pushPermission).toBeNull();
  });

  it('records both outcomes', () => {
    useNotificationStore.getState().setPushPermission('denied');
    expect(useNotificationStore.getState().pushPermission).toBe('denied');

    useNotificationStore.getState().setPushPermission('granted');
    expect(useNotificationStore.getState().pushPermission).toBe('granted');
  });
});

describe('registration records the permission outcome', () => {
  const hook = read('hooks/useNotifications.ts');

  it('no longer swallows a denial', () => {
    const denial = hook.slice(hook.indexOf("if (finalStatus !== 'granted')"));
    expect(denial).toContain("setPushPermission('denied')");
  });

  it('also records the granted case, so a re-grant clears the warning', () => {
    expect(hook).toContain("setPushPermission('granted')");
  });
});

describe('the runner is told the truth when going online', () => {
  const home = read('app/(runner)/(tabs)/index.tsx');

  it('does not claim readiness when notifications are denied', () => {
    const idx = home.indexOf("pushPermission === 'denied'");
    expect(idx).toBeGreaterThan(-1);

    // The honest branch must REPLACE the success copy, not sit beside it.
    const branch = home.slice(idx, idx + 700);
    expect(branch).toMatch(/notifications are off/);
    expect(branch).toMatch(/toast\.warning/);
  });

  it('offers a route out, since the OS dialog cannot be re-shown', () => {
    expect(home).toContain('Linking.openSettings()');
  });

  it('still congratulates a runner whose notifications work', () => {
    // Matched without the apostrophe: this file stores it as the escape
    // sequence ’, so asserting on the literal character couples the test
    // to whichever form the formatter last left behind.
    expect(home).toContain('online and ready for errands.');
  });
});
