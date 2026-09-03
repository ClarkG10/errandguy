import fs from 'fs';
import path from 'path';

/**
 * Sliding session, client half.
 *
 * `SANCTUM_EXPIRATION` is 30 days and nothing renewed it, so every user was
 * signed out a month after their last password entry — at an arbitrary moment,
 * possibly mid-errand or mid-checkout. The server now mints a replacement near
 * expiry and returns it in `X-New-Token`; `adoptRotatedToken` swaps it in.
 *
 * The interceptor can't be exercised here (axios instance + secure storage +
 * the native module graph), so its wiring is guarded by source shape — the
 * approach this repo already uses for RN-runtime-only code. Each assertion
 * below pins a decision that is easy to "simplify" back into a bug.
 */
const api = fs.readFileSync(path.join(__dirname, '..', 'api.ts'), 'utf8');

const adopt = api.slice(
  api.indexOf('function adoptRotatedToken('),
  api.indexOf('async function endSession('),
);

describe('sliding session: adopting a rotated token', () => {
  it('runs on successful responses', () => {
    expect(api).toContain('adoptRotatedToken(response)');
  });

  it('reads the header case-insensitively', () => {
    // axios lowercases response header keys, but the exact casing is not
    // guaranteed across platforms/adapters — checking one spelling only is a
    // silent no-op on whichever platform disagrees.
    expect(adopt).toContain("'x-new-token'");
    expect(adopt).toContain("'X-New-Token'");
  });

  it('is a no-op when the header is absent', () => {
    // Purely additive: an older API, or a token with life left, must change
    // nothing at all.
    expect(adopt).toMatch(/if \(typeof fresh !== 'string' \|\| !fresh\) return;/);
  });

  it('writes through to the store the REQUEST interceptor actually reads', () => {
    // The request interceptor authenticates from secureStorage, not from the
    // zustand copy. Updating only the store would leave every subsequent
    // request on the old token — i.e. the logout cliff, unmoved.
    expect(adopt).toContain("secureStorage.set('auth_token', fresh)");
  });

  it('compares against secureStorage, not the store copy', () => {
    // Those two diverge during a pending biometric unlock, where the store's
    // token is deliberately empty while secureStorage still authenticates.
    expect(adopt).toContain("secureStorage.peek('auth_token') === fresh");
  });

  it('does not fabricate a store token while a biometric unlock is pending', () => {
    // `token` is withheld from state on purpose in that state; writing one
    // back would fight the lock design.
    expect(adopt).toMatch(/if \(useAuthStore\.getState\(\)\.token\)/);
  });

  it('never throws into the response path', () => {
    // A session refresh must not be able to fail a response the caller is
    // already waiting on.
    expect(adopt).toMatch(/try \{/);
    expect(adopt).toMatch(/\} catch \{/);
  });

  it('does not block the response on a storage write', () => {
    expect(adopt).toContain('void secureStorage.set');
  });
});
