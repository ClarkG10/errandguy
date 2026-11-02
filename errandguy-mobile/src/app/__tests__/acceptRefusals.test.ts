import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A runner's accept refused for THEM — the errand needs a motorcycle, or it
 * is their own — is worded by the server. ACCEPT_NOT_ALLOWED passes through
 * the catalog as-is (errorCatalog.test.ts); an older server sent the same
 * sentences as BOOKING_CONFLICT, so both accept paths opt in to trusting it
 * rather than showing "Finish or cancel your errand in progress".
 *
 * The runner layout (offer pop-up) and the cockpit can't be rendered under
 * jest, so the wiring is pinned against the source.
 */
const read = (...parts: string[]) =>
  readFileSync(join(__dirname, '..', ...parts), 'utf8');

describe('accept refusals show the server’s reason', () => {
  it('on the offer pop-up', () => {
    const LAYOUT = read('(runner)', '_layout.tsx');
    const accept = LAYOUT.slice(
      LAYOUT.indexOf('const handleAccept = useCallback'),
      LAYOUT.indexOf('const handleDecline'),
    );
    expect(accept).toMatch(
      /errorMessage\(err, copy\.runner\.acceptFailed, \{\s*trustServerMessageFor: LEGACY_WORDED_REFUSALS,\s*\}\)/,
    );
  });

  it('on the errand screen’s claim', () => {
    const COCKPIT = read('(runner)', 'errand', '[id].tsx');
    const claim = COCKPIT.slice(COCKPIT.indexOf('await runnerService.acceptErrand(booking.id)'));
    expect(claim.slice(0, 2000)).toMatch(/trustServerMessageFor: LEGACY_WORDED_REFUSALS/);
  });
});
