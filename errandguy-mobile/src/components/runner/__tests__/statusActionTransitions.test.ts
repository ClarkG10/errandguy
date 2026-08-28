import { getNextStatus } from '../StatusActionButton';

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
