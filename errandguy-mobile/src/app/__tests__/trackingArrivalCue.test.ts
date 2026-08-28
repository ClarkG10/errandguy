import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The "runner is nearby" event has exactly ONE owner of the device banner:
 * the server (LocationService::notifyCustomerOnApproach fires a push per leg
 * at ~300m, which also persists the in-app row). The customer tracking screen
 * used to schedule its own local notification at 250m as well, so a customer
 * sitting on the screen got two banners seconds apart for one approach.
 *
 * The screen keeps the toast + haptic — those are in-context cues that can
 * never collide with a system banner — and schedules nothing.
 *
 * Rendering this 2.8k-line screen under jest would mean standing up the map,
 * router, sockets and every store, so the invariant is pinned against the
 * source the way the backend pins its lock ordering.
 */
const SOURCE = readFileSync(
  join(__dirname, '..', '(customer)', 'tracking', '[id].tsx'),
  'utf8',
);

describe('customer tracking arrival cue', () => {
  it('schedules no local notification — the server owns the approach push', () => {
    expect(SOURCE).not.toMatch(/scheduleNotificationAsync/);
    expect(SOURCE).not.toMatch(/from 'expo-notifications'/);
  });

  it('still fires the in-screen toast + haptic when the runner closes in', () => {
    const cue = SOURCE.slice(SOURCE.indexOf('const arrivalCueRef'));
    const effect = cue.slice(0, cue.indexOf('\n  }, ['));
    expect(effect).toMatch(/eta\.distanceMeters < 250/);
    expect(effect).toMatch(/Haptics\.impactAsync/);
    expect(effect).toMatch(/toast\.success\(msg\)/);
  });
});
