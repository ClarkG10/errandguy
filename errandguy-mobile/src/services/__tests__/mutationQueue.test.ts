/**
 * Offline mutation queue — the contract that makes an offline tick / review
 * safe to replay: coalescing per dedupeKey, permanent-4xx drop, transient
 * retry, expiry, and handlers that hit the SAME service call the online path
 * uses.
 */
import {
  isQueueable,
  queueable,
  enqueueMutation,
  flushMutationQueue,
  clearMutationQueue,
  useMutationQueueStore,
} from '../mutationQueue';
import { useNetworkStore } from '../../stores/networkStore';

// expo-crypto isn't mocked globally; the queue only needs unique ids.
let mockUuidSeq = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `uuid-${++mockUuidSeq}`,
}));

const mockInvalidateQuery = jest.fn();
jest.mock('../../hooks/useQuery', () => ({
  invalidateQuery: (...args: unknown[]) => mockInvalidateQuery(...args),
}));

// Service mocks — keeps the whole api.ts/axios graph out of the test while
// still proving each handler calls the right method with the right args.
const mockUpdateChecklistTicks = jest.fn();
const mockCompleteStop = jest.fn();
const mockReviewBooking = jest.fn();

jest.mock('../runner.service', () => ({
  runnerService: {
    updateChecklistTicks: (...a: unknown[]) => mockUpdateChecklistTicks(...a),
    completeStop: (...a: unknown[]) => mockCompleteStop(...a),
    updateRunnerProfile: jest.fn(),
  },
}));
jest.mock('../booking.service', () => ({
  bookingService: {
    reviewBooking: (...a: unknown[]) => mockReviewBooking(...a),
  },
}));
jest.mock('../notification.service', () => ({ notificationService: {} }));
jest.mock('../user.service', () => ({ userService: {} }));
jest.mock('../payment.service', () => ({ paymentService: {} }));

const pending = () => useMutationQueueStore.getState().pending;

beforeEach(async () => {
  jest.clearAllMocks();
  mockUpdateChecklistTicks.mockResolvedValue({ data: {} });
  mockCompleteStop.mockResolvedValue({ data: {} });
  mockReviewBooking.mockResolvedValue({ data: {} });
  useNetworkStore.setState({ isOffline: false, lastChangedAt: null });
  await clearMutationQueue();
});

describe('mutationQueue — registry', () => {
  it('registers the checklist, stop-tick and review kinds', () => {
    expect(isQueueable('runner.updateChecklistTicks')).toBe(true);
    expect(isQueueable('runner.completeStop')).toBe(true);
    expect(isQueueable('booking.review')).toBe(true);
  });

  it('refuses an unregistered kind rather than silently queueing it', () => {
    expect(isQueueable('booking.cancel')).toBe(false);
    expect(enqueueMutation({ kind: 'booking.cancel', payload: {} })).toBeNull();
    expect(pending()).toHaveLength(0);
    expect(() => queueable('booking.cancel', {})).toThrow(/no handler/);
  });
});

describe('runner.updateChecklistTicks', () => {
  const spec = (itemId: string, checked: boolean) =>
    queueable(
      'runner.updateChecklistTicks',
      { bookingId: 'bk-1', items: [{ id: itemId, checked }] },
      {
        invalidate: [['runner', 'errand', 'byId', 'bk-1']],
        dedupeKey: `checklist-bk-1-${itemId}`,
      },
    );

  it('online commit calls the same service method a replay would', async () => {
    await spec('item-a', true).commit();
    expect(mockUpdateChecklistTicks).toHaveBeenCalledWith('bk-1', [
      { id: 'item-a', checked: true },
    ]);
  });

  it('coalesces repeated toggles of ONE item to its latest state', () => {
    enqueueMutation(spec('item-a', true).offline);
    enqueueMutation(spec('item-a', false).offline);
    enqueueMutation(spec('item-a', true).offline);

    expect(pending()).toHaveLength(1);
    expect(pending()[0].payload).toEqual({
      bookingId: 'bk-1',
      items: [{ id: 'item-a', checked: true }],
    });
  });

  it('never lets one item supersede a sibling item', async () => {
    enqueueMutation(spec('item-a', true).offline);
    enqueueMutation(spec('item-b', true).offline);
    expect(pending()).toHaveLength(2);

    await flushMutationQueue();

    expect(mockUpdateChecklistTicks).toHaveBeenNthCalledWith(1, 'bk-1', [
      { id: 'item-a', checked: true },
    ]);
    expect(mockUpdateChecklistTicks).toHaveBeenNthCalledWith(2, 'bk-1', [
      { id: 'item-b', checked: true },
    ]);
    expect(pending()).toHaveLength(0);
  });

  it('replays on flush and refreshes the errand', async () => {
    enqueueMutation(spec('item-a', true).offline);
    await flushMutationQueue();

    expect(mockUpdateChecklistTicks).toHaveBeenCalledTimes(1);
    expect(mockInvalidateQuery).toHaveBeenCalledWith(['runner', 'errand', 'byId', 'bk-1']);
    expect(pending()).toHaveLength(0);
  });

  it('drops a tick the server rejects (errand closed) and reconciles the UI', async () => {
    mockUpdateChecklistTicks.mockRejectedValue({ status: 422, message: 'nope' });
    enqueueMutation(spec('item-a', true).offline);

    await flushMutationQueue();

    expect(pending()).toHaveLength(0); // permanent 4xx — never retried
    expect(mockInvalidateQuery).toHaveBeenCalledWith(['runner', 'errand', 'byId', 'bk-1']);
  });

  it('keeps a tick that hit a transient 5xx for the next reconnect', async () => {
    mockUpdateChecklistTicks.mockRejectedValue({ status: 503 });
    enqueueMutation(spec('item-a', true).offline);

    await flushMutationQueue();

    expect(pending()).toHaveLength(1);
    expect(pending()[0].attempts).toBe(1);
  });

  it('stops replaying the moment the connection drops again', async () => {
    mockUpdateChecklistTicks.mockImplementation(async () => {
      useNetworkStore.setState({ isOffline: true });
      throw { status: 0 };
    });
    enqueueMutation(spec('item-a', true).offline);
    enqueueMutation(spec('item-b', true).offline);

    await flushMutationQueue();

    expect(mockUpdateChecklistTicks).toHaveBeenCalledTimes(1);
    expect(pending()).toHaveLength(2); // both still queued, neither penalised
    expect(pending()[0].attempts).toBe(0);
  });
});

describe('runner.completeStop', () => {
  // A stop tick is recorded in a guardhouse, a basement car park or a mall
  // interior — the same dead-signal places the shopping checklist gets used.
  // Its licence to sit on the queue is that the PATCH is a no-op on replay
  // (the server compares the requested state under a row lock), so the bar
  // here is: same call online and offline, stop-scoped coalescing, and no
  // retry of a verdict the server already gave.
  const spec = (stopId: string, completed: boolean) =>
    queueable(
      'runner.completeStop',
      { bookingId: 'bk-1', stopId, completed },
      {
        invalidate: [['runner', 'errand', 'byId', 'bk-1']],
        dedupeKey: `stop-bk-1-${stopId}`,
      },
    );

  it('online commit calls the same service method a replay would', async () => {
    await spec('stop-1', true).commit();
    expect(mockCompleteStop).toHaveBeenCalledWith('bk-1', 'stop-1', true);
  });

  it('coalesces a tick then an untick of ONE stop to its latest state', async () => {
    enqueueMutation(spec('stop-1', true).offline);
    enqueueMutation(spec('stop-1', false).offline);
    expect(pending()).toHaveLength(1);

    await flushMutationQueue();

    expect(mockCompleteStop).toHaveBeenCalledTimes(1);
    expect(mockCompleteStop).toHaveBeenCalledWith('bk-1', 'stop-1', false);
  });

  it('never lets one stop supersede a sibling stop', async () => {
    enqueueMutation(spec('stop-1', true).offline);
    enqueueMutation(spec('stop-2', true).offline);
    expect(pending()).toHaveLength(2);

    await flushMutationQueue();

    expect(mockCompleteStop).toHaveBeenNthCalledWith(1, 'bk-1', 'stop-1', true);
    expect(mockCompleteStop).toHaveBeenNthCalledWith(2, 'bk-1', 'stop-2', true);
    expect(pending()).toHaveLength(0);
  });

  it('replays on flush and refreshes the errand', async () => {
    enqueueMutation(spec('stop-1', true).offline);
    await flushMutationQueue();

    expect(mockCompleteStop).toHaveBeenCalledTimes(1);
    expect(mockInvalidateQuery).toHaveBeenCalledWith(['runner', 'errand', 'byId', 'bk-1']);
    expect(pending()).toHaveLength(0);
  });

  it('drops a tick the server rejects (errand closed) and reconciles the UI', async () => {
    mockCompleteStop.mockRejectedValue({ status: 422 });
    enqueueMutation(spec('stop-1', true).offline);

    await flushMutationQueue();

    expect(pending()).toHaveLength(0);
    expect(mockInvalidateQuery).toHaveBeenCalledWith(['runner', 'errand', 'byId', 'bk-1']);
  });

  it('keeps a tick that hit a transient 5xx for the next reconnect', async () => {
    mockCompleteStop.mockRejectedValue({ status: 503 });
    enqueueMutation(spec('stop-1', true).offline);

    await flushMutationQueue();

    expect(pending()).toHaveLength(1);
    expect(pending()[0].attempts).toBe(1);
  });
});

describe('booking.review', () => {
  const spec = (rating: number, comment?: string) =>
    queueable(
      'booking.review',
      { bookingId: 'bk-9', rating, comment },
      {
        invalidate: [['bookings'], ['booking', 'bk-9']],
        dedupeKey: 'review-bk-9',
      },
    );

  it('online commit posts the rating and comment', async () => {
    await spec(5, 'Great communication').commit();
    expect(mockReviewBooking).toHaveBeenCalledWith('bk-9', {
      rating: 5,
      comment: 'Great communication',
    });
  });

  it('coalesces a re-rate before the queue drains', () => {
    enqueueMutation(spec(3).offline);
    enqueueMutation(spec(5, 'Friendly').offline);

    expect(pending()).toHaveLength(1);
    expect(pending()[0].payload).toEqual({
      bookingId: 'bk-9',
      rating: 5,
      comment: 'Friendly',
    });
  });

  it('treats the "already reviewed" 422 as done, not as a failure', async () => {
    // The server's duplicate-submit no-op. The review IS recorded, so the
    // entry must clear rather than look like a rejected write.
    mockReviewBooking.mockRejectedValue({
      status: 422,
      message: 'You have already reviewed this booking.',
    });
    enqueueMutation(spec(5).offline);

    await flushMutationQueue();

    expect(pending()).toHaveLength(0);
    expect(mockInvalidateQuery).toHaveBeenCalledWith(['booking', 'bk-9']);
  });

  it('drops a review the server refuses outright (403)', async () => {
    mockReviewBooking.mockRejectedValue({ status: 403 });
    enqueueMutation(spec(5).offline);

    await flushMutationQueue();

    expect(pending()).toHaveLength(0);
  });

  it('retries a 5xx instead of losing the review', async () => {
    mockReviewBooking.mockRejectedValue({ status: 500 });
    enqueueMutation(spec(4).offline);

    await flushMutationQueue();
    expect(pending()).toHaveLength(1);

    mockReviewBooking.mockResolvedValue({ data: {} });
    await flushMutationQueue();
    expect(pending()).toHaveLength(0);
    expect(mockReviewBooking).toHaveBeenLastCalledWith('bk-9', {
      rating: 4,
      comment: undefined,
    });
  });
});

describe('queue-wide guards still hold for the new kinds', () => {
  it('never replays an intent older than 24h', async () => {
    enqueueMutation(
      queueable('booking.review', { bookingId: 'bk-old', rating: 5 }, {
        dedupeKey: 'review-bk-old',
      }).offline,
    );
    // Age the entry past MAX_AGE_MS.
    useMutationQueueStore.setState({
      pending: pending().map((m) => ({
        ...m,
        createdAt: Date.now() - 25 * 60 * 60 * 1000,
      })),
    });

    await flushMutationQueue();

    expect(mockReviewBooking).not.toHaveBeenCalled();
    expect(pending()).toHaveLength(0);
  });

  it('is a no-op while still offline', async () => {
    enqueueMutation(
      queueable('runner.updateChecklistTicks', {
        bookingId: 'bk-1',
        items: [{ id: 'item-a', checked: true }],
      }).offline,
    );
    useNetworkStore.setState({ isOffline: true });

    await flushMutationQueue();

    expect(mockUpdateChecklistTicks).not.toHaveBeenCalled();
    expect(pending()).toHaveLength(1);
  });
});
