/**
 * The Earnings tab holds its skeleton until the day totals answer. With the
 * GET layer's 30s timeout and two retries that could be about a minute behind
 * a slow server — for figures the tab can do without (it adds up the rows
 * instead). One short attempt only.
 */
const mockGet = jest.fn();

jest.mock('../api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: jest.fn(), put: jest.fn() },
}));
jest.mock('../../hooks/useQuery', () => ({ invalidateQuery: jest.fn() }));

import { runnerService } from '../runner.service';

describe('runnerService.getEarningsDaily', () => {
  it('asks once, briefly', async () => {
    mockGet.mockResolvedValue({ data: { data: null } });
    await runnerService.getEarningsDaily('week');
    expect(mockGet).toHaveBeenCalledWith(
      '/runner/earnings/daily',
      expect.objectContaining({ params: { period: 'this_week' }, retries: 0, timeout: 8000 }),
    );
  });
});
