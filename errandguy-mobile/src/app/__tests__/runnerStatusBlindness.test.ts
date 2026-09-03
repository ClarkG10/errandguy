import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isClosedStatus,
  isStatusBackwards,
  isTerminalStatus,
  STATUS_RANK,
} from '../../constants/statusRank';

/**
 * Screens that keep acting on an errand that has ended.
 *
 * Two live defects, one shared cause — a booking snapshot nobody refreshes:
 *   • runner/navigate/[id] kept voice-guiding to a CANCELLED errand and kept
 *     offering "I've Arrived", a POST the server can only 422, under copy
 *     ("Try again.") that asked the runner to retry it;
 *   • runner Home kept a phantom "active errand" after a remote cancel, and
 *     because every idle affordance is gated on `!activeErrand`, the phantom
 *     silently switched OFF the open-offers poll — the runner was frozen out
 *     of paid work with no visible cause.
 *
 * These screens can't be rendered under jest (map, router, Reverb socket, half
 * a dozen stores), so — as trackingArrivalCue / runnerCockpitStops already do
 * for the same reason — the invariants are pinned against the source. They are
 * the ones that quietly regress: a channel that gets dropped, a guard that
 * starts trusting a bare `null`, a revert that stops reconciling.
 */
const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const NAVIGATE = read('(runner)', 'navigate', '[id].tsx');
const HOME = read('(runner)', '(tabs)', 'index.tsx');
const COCKPIT = read('(runner)', 'errand', '[id].tsx');
const NAVIGATE_CODE = stripComments(NAVIGATE);
const HOME_CODE = stripComments(HOME);
const COCKPIT_CODE = stripComments(COCKPIT);

describe('statusRank — the one merge rule every consumer shares', () => {
  it('ranks the ladder monotonically', () => {
    expect(STATUS_RANK.accepted).toBeLessThan(STATUS_RANK.picked_up);
    expect(STATUS_RANK.picked_up).toBeLessThan(STATUS_RANK.delivered);
    expect(STATUS_RANK.delivered).toBeLessThan(STATUS_RANK.completed);
  });

  it('treats completed / cancelled / no_runner as terminal', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('no_runner')).toBe(true);
    expect(isTerminalStatus('in_transit')).toBe(false);
    expect(isTerminalStatus(null)).toBe(false);
  });

  it('rejects a backwards move but NEVER a cancellation, however late it lands', () => {
    expect(isStatusBackwards('accepted', 'in_transit')).toBe(true);
    expect(isStatusBackwards('in_transit', 'accepted')).toBe(false);
    // The guard exists to protect a live navigation; a cancellation must win.
    expect(isStatusBackwards('cancelled', 'in_transit')).toBe(false);
    expect(isStatusBackwards('no_runner', 'delivered')).toBe(false);
    // Unknown / missing statuses are never "backwards".
    expect(isStatusBackwards('mystery', 'in_transit')).toBe(false);
    expect(isStatusBackwards(undefined, 'in_transit')).toBe(false);
  });

  it('only completed / cancelled count as the runner store’s "clear" statuses', () => {
    expect(isClosedStatus('completed')).toBe(true);
    expect(isClosedStatus('cancelled')).toBe(true);
    // no_runner is terminal but is NOT what runnerStore.updateErrandStatus
    // clears on — the callers null the store themselves for it.
    expect(isClosedStatus('no_runner')).toBe(false);
  });
});

describe('navigate/[id] notices the errand ending', () => {
  it('subscribes to the booking status channel (it had none)', () => {
    expect(NAVIGATE_CODE).toContain('useEchoChannel');
    expect(NAVIGATE_CODE).toContain("channel: `booking.${id ?? 'none'}`");
    expect(NAVIGATE_CODE).toContain("event: 'booking.status'");
  });

  it('merges through the SHARED rank rule, not a second private copy', () => {
    expect(NAVIGATE_CODE).toContain("from '../../../constants/statusRank'");
    expect(NAVIGATE_CODE).toContain('isStatusBackwards(');
    // No re-declared local rank table on either screen.
    expect(NAVIGATE_CODE).not.toMatch(/const STATUS_RANK\s*[:=]/);
    expect(COCKPIT_CODE).not.toMatch(/const STATUS_RANK\s*[:=]/);
  });

  it('keeps a poll fallback behind the channel, disabled once terminal', () => {
    expect(NAVIGATE_CODE).toContain('useSmartPolling');
    expect(NAVIGATE_CODE).toContain('enabled: !!id && !!booking && !navTerminated');
  });

  it('stops voice, camera-follow and keep-awake on a terminal status', () => {
    expect(NAVIGATE_CODE).toContain('useKeepAwakeWhile(!navTerminated)');
    expect(NAVIGATE_CODE).toMatch(/if \(!navTerminated\) return;\s*stopVoice\(\);/);
    expect(NAVIGATE_CODE).toContain('setFollowCamera(false)');
    // The turn announcer must not speak for a dead errand.
    expect(NAVIGATE_CODE).toContain('if (navTerminated) return;');
  });

  it('replaces the HUD with an honest panel instead of offering "I’ve Arrived"', () => {
    expect(NAVIGATE_CODE).toContain('if (navTerminated) {');
    expect(NAVIGATE).toContain('This errand was cancelled');
    expect(NAVIGATE).toContain('You can stop heading there.');
    expect(NAVIGATE).toContain('Back to errand');
  });

  it('no longer tells the runner to retry a transition that can never succeed', () => {
    expect(NAVIGATE_CODE).not.toContain('Could not mark arrived. Try again.');
    // Routed through the shared catalog (BOOKING_STATE_INVALID → "This errand
    // already moved on") with the runner's own fallback.
    expect(NAVIGATE_CODE).toContain('errorMessage(err, copy.runner.statusUpdateFailed)');
  });
});

describe('runner Home clears the phantom active errand', () => {
  it('watches the store errand’s booking channel', () => {
    expect(HOME_CODE).toContain('useEchoChannel');
    expect(HOME_CODE).toContain("channel: `booking.${watchedErrandId ?? 'none'}`");
    expect(HOME_CODE).toContain("event: 'booking.status'");
    expect(HOME_CODE).toContain('enabled: !!watchedErrandId');
  });

  it('re-arms the idle surface (offer feed) when the errand goes terminal', () => {
    // updateErrandStatus('completed'|'cancelled') is what nulls currentErrand,
    // which is what un-gates the `!activeErrand` open-offers poll.
    expect(HOME_CODE).toContain('store.updateErrandStatus(incoming.status)');
    expect(HOME_CODE).toContain("invalidateQuery(['runner', 'errand', 'current'])");
    expect(HOME).toContain('This errand was cancelled');
  });

  it('verifies against the errand itself before erasing anything', () => {
    // A bare settled `null` is NOT taken as proof — a dropped request must not
    // wipe a live errand card mid-job.
    expect(HOME_CODE).toContain('if (isOffline) return;');
    expect(HOME_CODE).toContain('if (currentErrandQ.loading || currentErrandQ.error) return;');
    expect(HOME_CODE).toContain('if (currentErrandQ.updatedAt == null) return;');
    expect(HOME_CODE).toContain('runnerService\n      .getErrand(stale.id)');
    expect(HOME_CODE).toContain('if (!isTerminalStatus(fresh.status)) return;');
    // Gone / not ours is also a clear; anything transient re-arms the check.
    expect(HOME_CODE).toContain('if (status === 404 || status === 403)');
  });
});

describe('cockpit: a transport failure is not a rejection', () => {
  it('reconciles with the server before reverting an optimistic transition', () => {
    expect(COCKPIT_CODE).toContain('const transportClass =');
    expect(COCKPIT_CODE).toContain('runnerService.getErrand(prev.id)');
    // Landed after all → keep the server's state instead of reverting into a
    // status whose CTA can only 422 ("delivered" → "delivered").
    expect(COCKPIT_CODE).toMatch(/if \(applied && fresh\) \{/);
    // A 4xx still reverts honestly — that IS the server's verdict.
    expect(COCKPIT_CODE).toContain('fetchedQ.mutate(prev);');
  });

  it('keeps the captured proof for a retry, and drops it only on a real verdict', () => {
    expect(COCKPIT_CODE).toContain('savePendingProof({');
    expect(COCKPIT_CODE).toContain('initialUri={');
    expect(COCKPIT_CODE).toContain('handleResumePendingProof');
    // Cleared on confirmation and on a permanent 4xx; 408/429 stay stashed.
    expect(COCKPIT_CODE).toContain('httpStatus !== 408');
    expect(COCKPIT_CODE).toContain('httpStatus !== 429');
  });

  it('never puts a status transition on the silent replay queue', () => {
    // The mutation queue's contract forbids booking-state transitions; the
    // resume is a persisted artifact plus a button, not an auto-replay.
    expect(COCKPIT_CODE).not.toMatch(/queueable\(\s*['"]runner\.(advance|updateErrandStatus)/);
  });
});
