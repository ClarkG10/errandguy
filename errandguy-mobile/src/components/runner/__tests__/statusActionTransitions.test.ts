import { getNextStatus } from '../StatusActionButton';
import {
  ERRAND_TYPE_SLUGS,
  getErrandTypeRule,
  type BookingStatusKey,
} from '../../../constants/errandTypeRules';

/**
 * A booking in `matched` has been OFFERED to the runner, not claimed by them —
 * the state a "New errand offer" push tap lands in. The cockpit CTA used to
 * treat it as `accepted` and fire updateStatus('heading_to_pickup') against a
 * server whose ladder starts at 'accepted', so every tap returned 422 and the
 * runner had no way to take the job. The cockpit now claims the errand first.
 *
 * These pin the transition map the CTA reads, so a future edit can't quietly
 * reintroduce a status advance that skips the accept.
 */
describe('getNextStatus', () => {
  it('walks the standard delivery ladder in order', () => {
    expect(getNextStatus('accepted', 'delivery')).toBe('heading_to_pickup');
    expect(getNextStatus('heading_to_pickup', 'delivery')).toBe('arrived_at_pickup');
    expect(getNextStatus('arrived_at_pickup', 'delivery')).toBe('picked_up');
  });

  it('has no next step past the end of a flow', () => {
    expect(getNextStatus('completed', 'delivery')).toBeNull();
  });

  it('returns null for a status outside the flow', () => {
    expect(getNextStatus('cancelled', 'delivery')).toBeNull();
  });

  /**
   * Documents the mapping the accept branch depends on: `matched` still
   * resolves to the post-accept step, which is precisely why the cockpit must
   * intercept it and call accept instead of advancing.
   */
  it('maps matched onto the post-accept step rather than an accept action', () => {
    expect(getNextStatus('matched', 'delivery')).toBe(getNextStatus('accepted', 'delivery'));
  });

  it('respects single-location flows that skip transit and handover', () => {
    const next = getNextStatus('picked_up', 'queue');
    expect(next).not.toBe('in_transit');
    expect(next).toBe('completed');
  });
});

/**
 * ARCH GUARDS over every errand type's action ladder.
 *
 * StatusActionButton renders `rule.statusActions[status]` verbatim as the
 * single most-tapped control in the runner product — hit one-handed at a
 * motorcycle stop. Transportation used to break the ladder's grammar twice:
 * `picked_up` read "In transit" (a STATUS NOUN, so the driver could not tell
 * whether it described their state or offered to change it) and `in_transit`
 * read "Arriving at drop-off" (about to happen) where every other ladder's
 * identical transition reads "Arrived at drop-off" (it has happened). A driver
 * who works both errand types was taught two contradictory meanings for the
 * button they tap the moment they pull up.
 *
 * These sweep ALL ladders so the next errand type cannot reintroduce it.
 */
describe('runner action ladders', () => {
  const ladders = ['__default__', ...ERRAND_TYPE_SLUGS].map((slug) => ({
    slug,
    rule: getErrandTypeRule(slug === '__default__' ? null : slug),
  }));

  it('names the in_transit transition identically in every ladder', () => {
    const phrasings = new Set(
      ladders
        .map(({ rule }) => rule.statusActions.in_transit)
        .filter((label): label is string => !!label),
    );
    expect(phrasings.size).toBe(1);
    // Past tense: the runner is REPORTING they have pulled up.
    expect([...phrasings][0]).toBe('Arrived at drop-off');
  });

  it('gives every non-terminal step of every flow an action, and no orphan labels', () => {
    for (const { slug, rule } of ladders) {
      const flow = rule.statusFlow;
      // Terminal step needs no button; every step before it does, or the
      // runner reaches a status with nothing to tap.
      for (const status of flow.slice(0, -1)) {
        expect(rule.statusActions[status]).toBeTruthy();
      }
      for (const key of Object.keys(rule.statusActions) as BookingStatusKey[]) {
        expect(flow).toContain(key);
        // …and the label must actually be reachable: an action on the terminal
        // step can never render.
        expect(flow.indexOf(key)).toBeLessThan(flow.length - 1);
      }
      expect(slug).toBeTruthy();
    }
  });

  /**
   * Tripwire, not grammar analysis: the set of words the ladders open with is
   * pinned. A new label starting with anything else — "In transit" would add
   * "In" — fails here and has to be justified rather than merged quietly.
   */
  it('opens every action label with one of the established verb forms', () => {
    const openers = new Set(
      ladders.flatMap(({ rule }) =>
        Object.values(rule.statusActions).map((label) => (label ?? '').split(' ')[0]),
      ),
    );
    expect([...openers].sort()).toEqual(
      [
        'Arrived',
        'Buy',
        'Complete',
        'Confirm',
        'Hand',
        'Head',
        'I’ve',
        'I’m',
        'Mark',
        'My',
        'Pay',
        'Pick',
        'Start',
        'Submit',
      ].sort(),
    );
  });

  /** The specific ladder that was wrong, pinned end to end. */
  it('pins the transportation ladder to verb-led, correctly-tensed labels', () => {
    const { statusActions } = getErrandTypeRule('transportation');
    expect(statusActions).toEqual({
      accepted: 'Head to passenger',
      heading_to_pickup: 'I’ve arrived',
      arrived_at_pickup: 'Start ride',
      picked_up: 'Start the trip',
      in_transit: 'Arrived at drop-off',
      arrived_at_dropoff: 'Complete ride',
    });
  });

  /**
   * StatusActionButton lowercases the first character to build the
   * "Slide to …" label for the consequential transitions, so a label that
   * doesn't start with a capital produces a broken sentence.
   */
  it('capitalises every label so the Slide-to-confirm rewrite reads correctly', () => {
    for (const { rule } of ladders) {
      for (const label of Object.values(rule.statusActions)) {
        expect(label).toMatch(/^[A-Z]/);
      }
    }
  });
});
