import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Architecture: ONE rule for PH mobile numbers (utils/phone), applied where
 * requests are built — so no screen can send "0917…" while another sends
 * "+63917…" for the same person, and no screen keeps a private regex that
 * drifts from the server's.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('mobile numbers are normalised where requests are built', () => {
  it('auth: sign-up, sign-in by phone and OTP', () => {
    const src = read('services/auth.service.ts');
    expect(src.match(/phoneForApi\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('profile and trusted contacts', () => {
    const src = read('services/user.service.ts');
    expect(src).toMatch(/'\/user\/profile',[\s\S]*?phoneForApi\(data\.phone\)/);
    expect(src).toMatch(/'\/user\/trusted-contacts', \{ \.\.\.data, phone: phoneForApi\(data\.phone\) \}/);
  });

  it('errand contacts', () => {
    const src = read('services/booking.service.ts');
    expect(src).toMatch(/pickup_contact_phone: phoneForApi/);
    expect(src).toMatch(/dropoff_contact_phone: phoneForApi/);
    expect(src).toMatch(/contact_phone: phoneForApi\(s\.contact_phone\)/);
  });

  it('GCash / Maya payout numbers', () => {
    expect(read('utils/payoutDestination.ts')).toMatch(/account_number: phoneForApi\(/);
  });

  it('no screen or helper keeps its own PH-mobile regex', () => {
    for (const rel of [
      'app/(auth)/register.tsx',
      'app/(auth)/login.tsx',
      'app/(runner)/settings/edit-profile.tsx',
      'components/safety/TrustedContactsScreen.tsx',
      'utils/payoutDestination.ts',
      'utils/validation/schemas.ts',
    ]) {
      expect(read(rel)).not.toMatch(/9\\d\{9\}/);
    }
  });
});
