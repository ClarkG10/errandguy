/**
 * Runner cold-start warm-up: the /runner/home aggregate fan-out.
 *
 * The mirror of preloadCustomerHome.test.ts, and for the same reason: the
 * contract is a CACHE-SEEDING one and getting it wrong is silent — a wrong key
 * or a wrong value shape doesn't throw, it just poisons the entry the runner
 * dashboard paints from on its first frame. So these tests pin, per section:
 *   • the exact useQuery cache key string (peak-hours carries NO userId — the
 *     dashboard nudge and the Demand screen deliberately share one entry),
 *   • the exact value shape (an OFFLINE runner's empty offer list is SEEDED,
 *     not skipped),
 *   • the TTL,
 * and pin that a successful aggregate costs ONE request while any failure
 * degrades to precisely the six per-endpoint seeds that shipped before it.
 */
import { preloadRunnerEssentials } from '../preload.service';
import { CacheTTL } from '../cache.service';

// ── Cache writes are the assertion surface ────────────────────────────────
const mockCacheSet = jest.fn(() => Promise.resolve());
jest.mock('../cache.service', () => {
  const actual = jest.requireActual('../cache.service');
  return {
    ...actual,
    CacheService: {
      ...actual.CacheService,
      set: (...a: unknown[]) => mockCacheSet(...(a as [])),
    },
  };
});

// ── The aggregate request. It lives on the raw client until runner.service
//    grows getHome(), so that is what we count round trips on. ─────────────
const mockApiGet = jest.fn();
jest.mock('../api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockApiGet(...a) },
}));

// ── Service mocks — keep the axios graph out and count the round trips ────
const mockGetRunnerProfile = jest.fn();
const mockGetEarnings = jest.fn();
const mockGetErrandHistory = jest.fn();
const mockGetAvailableErrands = jest.fn();
const mockGetCurrentErrand = jest.fn();

jest.mock('../runner.service', () => ({
  runnerService: {
    getRunnerProfile: (...a: unknown[]) => mockGetRunnerProfile(...a),
    getEarnings: (...a: unknown[]) => mockGetEarnings(...a),
    getErrandHistory: (...a: unknown[]) => mockGetErrandHistory(...a),
    getAvailableErrands: (...a: unknown[]) => mockGetAvailableErrands(...a),
    getCurrentErrand: (...a: unknown[]) => mockGetCurrentErrand(...a),
    getEarningsHistory: jest.fn(() => Promise.resolve({ data: { data: [] } })),
    getPayoutHistory: jest.fn(() => Promise.resolve({ data: { data: [] } })),
  },
}));
jest.mock('../user.service', () => ({
  userService: {
    getCustomerHome: jest.fn(() => Promise.resolve({ data: { data: null } })),
    getAddresses: jest.fn(() => Promise.resolve({ data: { data: [] } })),
    getTrustedContacts: jest.fn(() => Promise.resolve({ data: { data: [] } })),
    getReferral: jest.fn(() => Promise.resolve({ data: { data: null } })),
  },
}));
jest.mock('../config.service', () => ({
  configService: {
    getErrandTypes: jest.fn(() => Promise.resolve({ data: { data: [] } })),
    getPromos: jest.fn(() => Promise.resolve({ data: { data: [] } })),
  },
}));
jest.mock('../booking.service', () => ({
  bookingService: {
    getActiveBooking: jest.fn(() => Promise.resolve({ data: { data: null } })),
    getBookings: jest.fn(() => Promise.resolve({ data: { data: [] } })),
  },
}));
jest.mock('../payment.service', () => ({
  paymentService: {
    getWalletBalance: jest.fn(() => Promise.resolve({ data: { data: { balance: 0 } } })),
    getWalletTransactions: jest.fn(() => Promise.resolve({ data: { data: [] } })),
    getPaymentMethods: jest.fn(() => Promise.resolve({ data: { data: [] } })),
  },
}));
jest.mock('../notification.service', () => ({
  notificationService: {
    getUnreadCount: jest.fn(() => Promise.resolve({ data: { data: { count: 0 } } })),
    getNotifications: jest.fn(() => Promise.resolve({ data: { data: [] } })),
  },
}));
jest.mock('../chat.service', () => ({
  chatService: { getConversations: jest.fn(() => Promise.resolve({ data: { data: [] } })) },
}));
jest.mock('../../stores/chatStore', () => ({
  useChatStore: { getState: () => ({ messages: {}, setMessages: jest.fn() }) },
}));
jest.mock('../../stores/bookingStore', () => ({
  useBookingStore: { getState: () => ({ setActiveBooking: jest.fn() }) },
}));
jest.mock('expo-asset', () => ({ Asset: { loadAsync: jest.fn(() => Promise.resolve([])) } }));

const USER = 'runner-1';

const PROFILE = { id: 'rp-1', is_online: true, rating: 4.9 };
const EARNINGS_TODAY = { total_earnings: 480, total_tips: 30, completed_count: 3 };
const EARNINGS_WEEK = { total_earnings: 3120, total_tips: 210, completed_count: 19 };
const RECENT = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }];
const OFFERS = [{ id: 'offer-1' }];
const CURRENT = { id: 'b-live', status: 'in_transit' };
const PEAK = { days: 30, grid: Array.from({ length: 7 }, () => new Array(24).fill(0)) };

const aggregate = (overrides: Record<string, unknown> = {}) => ({
  data: {
    data: {
      profile: PROFILE,
      earnings_today: EARNINGS_TODAY,
      earnings_week: EARNINGS_WEEK,
      recent_errands: RECENT,
      available_errands: OFFERS,
      current_errand: CURRENT,
      peak_hours: PEAK,
      ...overrides,
    },
  },
});

/** Let the un-awaited below-the-fold pool settle so it can't leak between tests. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

/** key → { value, ttl } for every CacheService.set the warm-up performed. */
const writes = () => {
  const out: Record<string, { value: unknown; ttl: number }> = {};
  for (const call of mockCacheSet.mock.calls as unknown as Array<
    [string, { value: unknown }, number]
  >) {
    out[call[0]] = { value: call[1]?.value, ttl: call[2] };
  }
  return out;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApiGet.mockResolvedValue(aggregate());
  mockGetRunnerProfile.mockResolvedValue({ data: { data: PROFILE } });
  mockGetEarnings.mockImplementation((period: string) =>
    Promise.resolve({ data: { data: period === 'today' ? EARNINGS_TODAY : EARNINGS_WEEK } }),
  );
  mockGetErrandHistory.mockResolvedValue({ data: { data: RECENT } });
  mockGetAvailableErrands.mockResolvedValue({ data: { data: OFFERS } });
  mockGetCurrentErrand.mockResolvedValue({ data: { data: CURRENT } });
});

describe('preloadRunnerEssentials — /runner/home aggregate fan-out', () => {
  it('costs ONE round trip and fires none of the endpoints it replaces', async () => {
    await preloadRunnerEssentials(USER);
    await flush();

    expect(mockApiGet).toHaveBeenCalledTimes(1);
    expect(mockApiGet.mock.calls[0][0]).toBe('/runner/home');

    // The six above-the-fold requests this aggregate stands in for.
    expect(mockGetRunnerProfile).not.toHaveBeenCalled();
    expect(mockGetAvailableErrands).not.toHaveBeenCalled();
    expect(mockGetCurrentErrand).not.toHaveBeenCalled();
    expect(mockGetEarnings).not.toHaveBeenCalledWith('today');
    expect(mockGetEarnings).not.toHaveBeenCalledWith('week');
    // Still exactly the two below-the-fold calls, unchanged.
    expect(mockGetEarnings).toHaveBeenCalledTimes(1);
    expect(mockGetEarnings).toHaveBeenCalledWith('month');
    expect(mockGetErrandHistory).toHaveBeenCalledTimes(1);
    expect(mockGetErrandHistory).toHaveBeenCalledWith({ page: 1, per_page: 15 });
  });

  it('seeds the exact useQuery keys, shapes and TTLs each screen reads', async () => {
    await preloadRunnerEssentials(USER);
    const w = writes();

    expect(w[`q:runner:profile:${USER}`]).toEqual({ value: PROFILE, ttl: CacheTTL.LONG });
    expect(w[`q:runner:earnings:today:${USER}`]).toEqual({
      value: EARNINGS_TODAY,
      ttl: CacheTTL.MEDIUM,
    });
    // The app's short form is 'week' even though the API period is 'this_week'.
    expect(w[`q:runner:earnings:week:${USER}`]).toEqual({
      value: EARNINGS_WEEK,
      ttl: CacheTTL.MEDIUM,
    });
    expect(w[`q:runner:errands:recent:${USER}`]).toEqual({ value: RECENT, ttl: CacheTTL.LONG });
    expect(w[`q:runner:errand:available:${USER}`]).toEqual({
      value: OFFERS,
      ttl: CacheTTL.SHORT,
    });
    expect(w[`q:runner:errand:current:${USER}`]).toEqual({
      value: CURRENT,
      ttl: CacheTTL.SHORT,
    });
  });

  it('seeds peak-hours under the SHARED key — no userId in it', async () => {
    await preloadRunnerEssentials(USER);
    const w = writes();

    // Both (runner)/(tabs)/index.tsx and demand.tsx read this exact key; a
    // userId in it would make the Demand screen refetch on every open.
    expect(w['q:runner:peak-hours:30']).toEqual({ value: PEAK, ttl: CacheTTL.LONG });
    expect(w[`q:runner:peak-hours:30:${USER}`]).toBeUndefined();
  });

  it('seeds an OFFLINE runner’s empty offer list rather than skipping the key', async () => {
    mockApiGet.mockResolvedValue(aggregate({ available_errands: [] }));

    await preloadRunnerEssentials(USER);

    // "No offers" is the correct cold state for an offline runner; a missing
    // key just costs the screen the round trip this endpoint exists to save.
    expect(writes()[`q:runner:errand:available:${USER}`]).toEqual({
      value: [],
      ttl: CacheTTL.SHORT,
    });
  });

  it('caches a genuine "no current errand" as null rather than skipping the key', async () => {
    mockApiGet.mockResolvedValue(aggregate({ current_errand: null }));

    await preloadRunnerEssentials(USER);

    expect(writes()[`q:runner:errand:current:${USER}`]).toEqual({
      value: null,
      ttl: CacheTTL.SHORT,
    });
  });

  it.each([
    ['null', null],
    ['a malformed grid', { days: 30, grid: 'nope' }],
  ])('leaves the shared peak-hours key a MISS on %s, keeping the rest', async (_l, peak) => {
    mockApiGet.mockResolvedValue(aggregate({ peak_hours: peak }));

    await preloadRunnerEssentials(USER);
    const w = writes();

    // Pinning junk there would flatten the Demand heatmap for the whole
    // freshness window; a miss makes the screen fetch normally.
    expect(w['q:runner:peak-hours:30']).toBeUndefined();
    // Peak-hours is a bonus section — it must not cost us the other six.
    expect(w[`q:runner:profile:${USER}`].value).toEqual(PROFILE);
    expect(mockGetRunnerProfile).not.toHaveBeenCalled();
  });
});

describe('preloadRunnerEssentials — fallback when the aggregate is unusable', () => {
  const expectPerEndpointFallback = () => {
    expect(mockGetRunnerProfile).toHaveBeenCalledTimes(1);
    expect(mockGetEarnings).toHaveBeenCalledWith('today');
    expect(mockGetEarnings).toHaveBeenCalledWith('week');
    expect(mockGetErrandHistory).toHaveBeenCalledWith({ page: 1, per_page: 3 });
    expect(mockGetAvailableErrands).toHaveBeenCalledTimes(1);
    expect(mockGetCurrentErrand).toHaveBeenCalledTimes(1);

    const w = writes();
    expect(w[`q:runner:profile:${USER}`]).toEqual({ value: PROFILE, ttl: CacheTTL.LONG });
    expect(w[`q:runner:earnings:today:${USER}`]).toEqual({
      value: EARNINGS_TODAY,
      ttl: CacheTTL.MEDIUM,
    });
    expect(w[`q:runner:errands:recent:${USER}`]).toEqual({ value: RECENT, ttl: CacheTTL.LONG });
    expect(w[`q:runner:errand:available:${USER}`]).toEqual({
      value: OFFERS,
      ttl: CacheTTL.SHORT,
    });
    expect(w[`q:runner:errand:current:${USER}`]).toEqual({
      value: CURRENT,
      ttl: CacheTTL.SHORT,
    });
  };

  it('degrades to the per-endpoint seeds when the request fails', async () => {
    mockApiGet.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }));

    await preloadRunnerEssentials(USER);
    await flush();

    expectPerEndpointFallback();
  });

  it('degrades when the endpoint does not exist (older server → 404 body)', async () => {
    mockApiGet.mockResolvedValue({ data: { message: 'Not Found' } });

    await preloadRunnerEssentials(USER);
    await flush();

    expectPerEndpointFallback();
  });

  it.each([
    ['a missing section', 'current_errand'],
    ['a null profile', 'profile'],
    ['a null offer list', 'available_errands'],
    ['a null earnings object', 'earnings_week'],
  ])('degrades on a partial payload: %s', async (_label, field) => {
    const payload = aggregate();
    if (field === 'current_errand') {
      delete (payload.data.data as Record<string, unknown>).current_errand;
    } else {
      (payload.data.data as Record<string, unknown>)[field] = null;
    }
    mockApiGet.mockResolvedValue(payload);

    await preloadRunnerEssentials(USER);
    await flush();

    expectPerEndpointFallback();
  });

  it('never rejects, even when the fallback endpoints fail too', async () => {
    mockApiGet.mockRejectedValue(new Error('offline'));
    mockGetRunnerProfile.mockRejectedValue(new Error('offline'));
    mockGetEarnings.mockRejectedValue(new Error('offline'));
    mockGetErrandHistory.mockRejectedValue(new Error('offline'));
    mockGetAvailableErrands.mockRejectedValue(new Error('offline'));
    mockGetCurrentErrand.mockRejectedValue(new Error('offline'));

    await expect(preloadRunnerEssentials(USER)).resolves.toBeUndefined();
    await flush();

    // A failed fetch must not write a poisoned entry.
    expect(writes()[`q:runner:profile:${USER}`]).toBeUndefined();
  });
});
