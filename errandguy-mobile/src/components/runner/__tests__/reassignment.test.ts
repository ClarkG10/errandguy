/**
 * Support taking an errand off a runner.
 *
 * BookingService::adminReturnToMatching broadcasts `booking.status` with
 * `status: 'pending'` and `runner_id: null` to the old runner. Every runner
 * surface used to drop that as a late, lower-ranked status, so the runner kept
 * working a job that was no longer theirs.
 */
import {
  REASSIGNED_MESSAGE,
  __resetTakenOffAnnouncements,
  isTakenOffBroadcast,
  releaseTakenOffErrand,
} from '../reassignment';
import { useRunnerStore } from '../../../stores/runnerStore';
import { toast } from '../../../stores/toastStore';
import { invalidateQuery } from '../../../hooks/useQuery';

jest.mock('../../../hooks/useQuery', () => ({
  invalidateQuery: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../stores/toastStore', () => ({
  toast: { warning: jest.fn() },
}));
jest.mock('../../../utils/haptics', () => ({
  haptics: { warning: jest.fn() },
}));

const ME = 'runner-1';
const working = { id: 'bk-1', status: 'heading_to_pickup' as const };

describe('isTakenOffBroadcast', () => {
  it('flags the return-to-matching broadcast on an errand the runner is working', () => {
    expect(
      isTakenOffBroadcast({ id: 'bk-1', status: 'pending', runner_id: null }, working, ME),
    ).toBe(true);
  });

  it('flags the errand landing on a different runner', () => {
    expect(
      isTakenOffBroadcast({ id: 'bk-1', status: 'matched', runner_id: 'runner-2' }, working, ME),
    ).toBe(true);
  });

  it('ignores an ordinary update that still names this runner', () => {
    expect(
      isTakenOffBroadcast({ id: 'bk-1', status: 'arrived_at_pickup', runner_id: ME }, working, ME),
    ).toBe(false);
  });

  it('leaves terminal statuses to their own handling', () => {
    expect(
      isTakenOffBroadcast({ id: 'bk-1', status: 'cancelled', runner_id: null }, working, ME),
    ).toBe(false);
  });

  it('never calls a lapsed or declined OFFER a reassignment', () => {
    expect(
      isTakenOffBroadcast(
        { id: 'bk-1', status: 'pending', runner_id: null },
        { id: 'bk-1', status: 'matched' },
        ME,
      ),
    ).toBe(false);
  });

  it('says nothing about ownership when the payload has no runner_id', () => {
    expect(isTakenOffBroadcast({ id: 'bk-1', status: 'pending' }, working, ME)).toBe(false);
  });

  it('ignores another booking and an unknown signed-in user', () => {
    expect(
      isTakenOffBroadcast({ id: 'bk-2', status: 'pending', runner_id: null }, working, ME),
    ).toBe(false);
    expect(
      isTakenOffBroadcast({ id: 'bk-1', status: 'pending', runner_id: null }, working, null),
    ).toBe(false);
  });
});

describe('releaseTakenOffErrand', () => {
  beforeEach(() => {
    __resetTakenOffAnnouncements();
    (toast.warning as jest.Mock).mockClear();
    (invalidateQuery as jest.Mock).mockClear();
    useRunnerStore.setState({ currentErrand: { id: 'bk-1', status: 'heading_to_pickup' } as never });
  });

  it('clears the errand, forgets cached copies and tells the runner', () => {
    releaseTakenOffErrand('bk-1');

    expect(useRunnerStore.getState().currentErrand).toBeNull();
    expect(invalidateQuery).toHaveBeenCalledWith(['runner', 'errand']);
    expect(toast.warning).toHaveBeenCalledWith(REASSIGNED_MESSAGE);
  });

  it('announces once when several surfaces hear the same broadcast', () => {
    releaseTakenOffErrand('bk-1'); // home
    releaseTakenOffErrand('bk-1'); // cockpit
    releaseTakenOffErrand('bk-1'); // turn-by-turn

    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("never clears a different errand the runner now holds", () => {
    useRunnerStore.setState({ currentErrand: { id: 'bk-9', status: 'accepted' } as never });

    releaseTakenOffErrand('bk-1');

    expect(useRunnerStore.getState().currentErrand?.id).toBe('bk-9');
  });
});
