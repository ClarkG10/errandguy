import fs from 'fs';
import path from 'path';

/**
 * A denied OS permission must never leave a dead button.
 *
 * Once a permission is denied the OS will not prompt again, so a button whose
 * only response is "nothing happened" — or advice the user has no way to
 * follow — is permanently broken from inside the app. The only working
 * recovery is a deep link into system settings.
 *
 * PhotoProofModal and ReceiptCaptureModal already did this; these two did not:
 *   • the registration avatar tile was SILENT (useImagePicker returns null and
 *     the caller never opted into onPermissionDenied) — on the app's first
 *     screen
 *   • "Import from contacts" said "Allow contacts access to import a contact",
 *     which is advice with no route, so tapping again just repeated it
 *
 * Source-shape guarded: none of these paths can run without the OS permission
 * APIs.
 */
const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

const SETTINGS_ROUTE = /Linking\.openSettings\(\)/;

describe('every permission-denied path offers a settings route', () => {
  const cases: Array<{ name: string; file: string }> = [
    { name: 'registration avatar', file: 'app/(auth)/register.tsx' },
    { name: 'import from contacts', file: 'app/(customer)/trusted-contacts/index.tsx' },
    // The two that already had it — pinned so they can't regress.
    { name: 'photo proof', file: 'components/runner/PhotoProofModal.tsx' },
    { name: 'receipt capture', file: 'components/runner/ReceiptCaptureModal.tsx' },
  ];

  it.each(cases)('$name routes the user to settings', ({ file }) => {
    expect(read(file)).toMatch(SETTINGS_ROUTE);
  });

  it.each(cases)('$name offers it as a tappable action, not just prose', ({ file }) => {
    // A message mentioning Settings is not a recovery path; the toast needs an
    // action the thumb can reach.
    expect(read(file)).toMatch(/actionLabel:\s*'Settings'/);
  });
});

describe('the registration avatar is no longer silent', () => {
  const source = read('app/(auth)/register.tsx');

  it('opts into the picker hook’s denial callback', () => {
    // Calling useImagePicker() with no options is exactly the bug: the hook
    // returns null and the caller has no idea why.
    expect(source).toContain('onPermissionDenied: handlePhotoPermissionDenied');
    expect(source).not.toMatch(/useImagePicker\(\)\s*;/);
  });

  it('uses the same copy as the other photo surfaces', () => {
    expect(source).toContain('Photo access is off — enable it in Settings');
  });
});

describe('contacts import no longer gives advice it cannot support', () => {
  const source = read('app/(customer)/trusted-contacts/index.tsx');

  it('dropped the unactionable message', () => {
    expect(source).not.toContain('Allow contacts access to import a contact.');
  });

  it('names the state and the fix', () => {
    expect(source).toContain('Contacts access is off — enable it in Settings');
  });
});
