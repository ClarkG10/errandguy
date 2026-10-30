import fs from 'fs';
import path from 'path';

/**
 * Help, terms and sign-up copy must describe the app as it now works:
 * fixed prices (no counter-offers), cash / GCash / Maya / wallet (no saved
 * cards), refunds to the wallet with a staff-reviewed withdrawal, runners
 * can't hand back an errand (staff reassign), the cancellation fee goes to the
 * runner, payouts are reviewed in 1–3 business days (not "instant"), and no
 * rating-based priority. And only REAL support channels: the in-app support
 * chat and the support email — the two hotline numbers were placeholders that
 * rang nobody.
 *
 * Copy lives in big screens that can't be rendered here, so it is pinned
 * against the source, comments stripped.
 */
const SRC = path.join(__dirname, '..', '..');
const read = (...p: string[]) =>
  fs
    .readFileSync(path.join(SRC, ...p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const CUSTOMER_HELP = read('app', '(customer)', 'help.tsx');
const RUNNER_HELP = read('app', '(runner)', 'settings', 'help.tsx');
const RUNNER_TERMS = read('app', '(runner)', 'settings', 'terms.tsx');
const LEGAL = read('components', 'auth', 'LegalModal.tsx');
const ROLE_SELECT = read('app', '(auth)', 'role-select.tsx');
const WELCOME = read('app', '(auth)', 'welcome.tsx');
const ALL = [CUSTOMER_HELP, RUNNER_HELP, RUNNER_TERMS, LEGAL, ROLE_SELECT, WELCOME];

describe('support channels are real', () => {
  it('no placeholder hotline survives in either app', () => {
    for (const src of [CUSTOMER_HELP, RUNNER_HELP]) {
      expect(src).not.toMatch(/917 123 4567|912 345 6789|9171234567|9123456789/);
      expect(src).not.toMatch(/tel:\+63/);
      expect(src).not.toMatch(/Hotline|Phone Support/);
    }
  });

  it('both help screens offer the in-app support chat and the support email', () => {
    for (const src of [CUSTOMER_HELP, RUNNER_HELP]) {
      expect(src).toContain("router.push('/(customer)/support')");
      expect(src).toContain('support@errandguyph.com');
    }
  });
});

describe('answers match how the system works now', () => {
  it('nothing promises instant payouts, priority by rating, bidding or saved cards', () => {
    for (const src of ALL) {
      expect(src).not.toMatch(/instant payout/i);
      expect(src).not.toMatch(/priority errand/i);
      expect(src).not.toMatch(/fare or offer/i);
    }
    expect(ROLE_SELECT).not.toContain("'Instant payouts'");
    expect(WELCOME).not.toContain('cashless payments');
  });

  it('customers: fixed price, the four ways to pay, refunds to wallet, reviewed withdrawals', () => {
    expect(CUSTOMER_HELP).toContain('no bidding, no counter-offers');
    expect(CUSTOMER_HELP).toContain('Cash, GCash or Maya');
    expect(CUSTOMER_HELP).toContain('we don’t save cards');
    expect(CUSTOMER_HELP).toContain('Refunds go to your wallet');
    expect(CUSTOMER_HELP).toContain('usually within 1–3 business days');
    expect(CUSTOMER_HELP).not.toMatch(/withdraw your wallet balance to GCash or Maya anytime/);
  });

  it('customers: the cancellation fee goes to the runner; runners can’t hand an errand back', () => {
    expect(CUSTOMER_HELP).toContain('the fee goes to the runner who accepted');
    expect(CUSTOMER_HELP).toContain('runners can’t hand it back');
    expect(CUSTOMER_HELP).not.toContain('You will be re-matched automatically');
  });

  it('runners: payouts are staff-reviewed, errands can’t be handed back, no rating priority', () => {
    expect(RUNNER_HELP).toContain('our team reviews each one');
    expect(RUNNER_HELP).toContain('usually within 1–3 business days');
    expect(RUNNER_HELP).not.toMatch(/request a payout[^.]*anytime/i);
    expect(RUNNER_HELP).toContain('you can’t hand it back in the app');
    expect(RUNNER_HELP).toContain('Your rating doesn’t change which offers you get');
    expect(RUNNER_HELP).toContain('the fee goes to you');
  });

  it('terms say the same', () => {
    expect(LEGAL).toContain('Prices are fixed');
    expect(LEGAL).toContain('there is no bidding or counter-offer');
    expect(LEGAL).toContain("we don't save cards");
    expect(LEGAL).toContain('it goes to that runner');
    expect(LEGAL).toContain('Refunds are credited to your ErrandGuy wallet');
    expect(RUNNER_TERMS).toContain('Once you accept an errand it stays yours');
    expect(RUNNER_TERMS).toContain('usually within 1–3 business days');
  });
});
