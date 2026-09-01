/**
 * `runnerService.completeStop` — the wire contract behind every multi-stop
 * tick, online and replayed.
 *
 * The mutation queue replays this exact method (see mutationQueue.test.ts), so
 * if the URL, the body shape or the default ever drift, an offline tick starts
 * hitting a different endpoint than the live one. Pinned here rather than
 * inferred from the screen.
 */
const mockPatch = jest.fn();
const mockInvalidateQuery = jest.fn();

jest.mock('../api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: (...a: unknown[]) => mockPatch(...a),
  },
}));
jest.mock('../../hooks/useQuery', () => ({
  invalidateQuery: (...a: unknown[]) => mockInvalidateQuery(...a),
}));

import { runnerService } from '../runner.service';

beforeEach(() => {
  jest.clearAllMocks();
  mockPatch.mockResolvedValue({ data: { data: {} } });
});

describe('runnerService.completeStop', () => {
  it('PATCHes the stop under the booking, defaulting to completed', async () => {
    await runnerService.completeStop('bk-1', 'stop-9');
    expect(mockPatch).toHaveBeenCalledWith('/runner/errand/bk-1/stops/stop-9', {
      completed: true,
    });
  });

  it('sends completed:false when the runner reopens a stop', async () => {
    await runnerService.completeStop('bk-1', 'stop-9', false);
    expect(mockPatch).toHaveBeenCalledWith('/runner/errand/bk-1/stops/stop-9', {
      completed: false,
    });
  });

  it('busts the errand caches so the tick reconciles to server truth', async () => {
    await runnerService.completeStop('bk-1', 'stop-9');
    // Flush the .then() chained inside the service.
    await Promise.resolve();
    expect(mockInvalidateQuery).toHaveBeenCalledWith(['runner', 'errand']);
    expect(mockInvalidateQuery).toHaveBeenCalledWith(['runner', 'errands']);
    expect(mockInvalidateQuery).toHaveBeenCalledWith(['bookings']);
  });

  it('never swallows a rejection into the invalidation chain', async () => {
    mockPatch.mockRejectedValue({ status: 422 });
    await expect(runnerService.completeStop('bk-1', 'stop-9')).rejects.toEqual({
      status: 422,
    });
  });
});
