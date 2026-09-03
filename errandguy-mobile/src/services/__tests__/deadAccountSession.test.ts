import fs from 'fs';
import path from 'path';

/**
 * A suspended / banned / deleted account used to be a ZOMBIE session.
 *
 * `EnsureUserActive` rejects every authenticated route with 403 once an account
 * dies, but the response interceptor handled 401 only — so `isAuthenticated`
 * stayed true, the root route gate kept the user inside the app, and each tab
 * failed with its own generic error toast. Nothing ever told them the account
 * was gone, so retrying was the only thing left to try.
 *
 * The interceptor itself can't be exercised here (it needs the axios instance,
 * secure storage and the native module graph), so its WIRING is guarded by
 * source shape — the same approach the tracking/rating tests use. The store
 * half is real behaviour and is tested as such.
 */
const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

describe('dead-account session teardown (interceptor wiring)', () => {
  const api = read('services/api.ts');

  it('ends the session on a 403 that carries a dead-account code', () => {
    expect(api).toMatch(/status === 403/);
    expect(api).toContain("'ACCOUNT_SUSPENDED'");
    expect(api).toContain("'ACCOUNT_INACTIVE'");
  });

  it('matches on the backend code, never on the human message', () => {
    // The 403 branch must key off `backendCode`. Support rewords the message,
    // and a client string-matching it would silently stop working that day.
    const branch = api.slice(api.indexOf('status === 403'));
    const guard = branch.slice(0, branch.indexOf('{'));
    expect(guard).toContain('backendCode');
    expect(guard).not.toMatch(/data\?\.message/);
  });

  it('routes 401 and the dead-account 403 through ONE teardown', () => {
    expect(api).toMatch(/async function endSession\(/);
    // Both paths call it — they were drifting, and only one of them existed.
    const calls = api.match(/await endSession\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('wipes account-scoped state ONLY for the dead account, not for a plain 401', () => {
    // A 401 is usually an expired token for an account about to sign back in as
    // itself: its booking draft and cached queries are the user's own work.
    // A dead account is never coming back, so the on-device PII and the offline
    // mutation queue must go — those writes would otherwise replay under
    // whoever signs in next on a shared handset.
    const wipes = api.match(/wipeAccountState:\s*true/g) ?? [];
    expect(wipes).toHaveLength(1);

    const deadBranch = api.slice(api.indexOf('status === 403'));
    expect(deadBranch).toMatch(/wipeAccountState:\s*true/);

    // The wipe itself lives in endSession, gated on that flag.
    const teardown = api.slice(
      api.indexOf('async function endSession('),
      api.indexOf('const isRetryableError'),
    );
    expect(teardown).toContain('clearAccountScopedState');
    expect(teardown).toMatch(/if \(opts\.wipeAccountState\)/);

    // The 401 branch sits before the 403 branch and must NOT wipe.
    const plain401 = api.slice(api.indexOf('status === 401'), api.indexOf('status === 403'));
    expect(plain401).not.toContain('wipeAccountState');
  });

  it('hands the reason to the auth store so the user can be told', () => {
    expect(api).toContain('sessionEndedReason');
  });
});

describe('dead-account session teardown (auth surface)', () => {
  it('announces the reason from the auth LAYOUT, covering both landing screens', () => {
    // The root gate picks login or welcome by `onboardingSeen`; announcing from
    // the layout covers both without duplicating the consume.
    const layout = read('app/(auth)/_layout.tsx');
    expect(layout).toContain('consumeSessionEndedReason');
    expect(layout).toMatch(/toast\.error/);
  });

  it('does not also announce it on the login screen (would double-toast)', () => {
    expect(read('app/(auth)/login.tsx')).not.toContain('consumeSessionEndedReason');
  });
});

describe('sessionEndedReason store slice', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('is read-and-clear, so an ordinary later sign-out cannot resurface it', () => {
    const { useAuthStore } = require('../../stores/authStore');

    useAuthStore.setState({ sessionEndedReason: 'Your account has been suspended.' });

    expect(useAuthStore.getState().consumeSessionEndedReason()).toBe(
      'Your account has been suspended.',
    );
    // Cleared by the read.
    expect(useAuthStore.getState().sessionEndedReason).toBeNull();
    // And a second read is empty — the toast fires exactly once.
    expect(useAuthStore.getState().consumeSessionEndedReason()).toBeNull();
  });

  it('starts empty and does not write state when there is nothing to report', () => {
    const { useAuthStore } = require('../../stores/authStore');

    expect(useAuthStore.getState().sessionEndedReason).toBeNull();
    expect(useAuthStore.getState().consumeSessionEndedReason()).toBeNull();
  });
});
