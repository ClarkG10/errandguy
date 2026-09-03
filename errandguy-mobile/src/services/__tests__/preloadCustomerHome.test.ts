/**
 * Customer cold-start warm-up: the /customer/home aggregate fan-out.
 *
 * The contract under test is a CACHE-SEEDING one, and getting it wrong is
 * silent — a wrong key or a wrong value shape doesn't throw, it just poisons
 * the entry the Home screen paints from on its first frame (the documented
 * "₱[object Object]" wallet bug). So these tests pin, per section:
 *   • the exact useQuery cache key string,
 *   • the exact value shape (notably wallet balance = a NUMBER),
 *   • the TTL,
 * and pin that a successful aggregate costs ONE request while any failure
 * degrades to precisely the per-endpoint seeds that shipped before it.
 */
import { preloadCustomerEssentials } from '../preload.service';
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

// ── Service mocks — keep the axios graph out and count the round trips ────
const mockGetCustomerHome = jest.fn();
const mockGetErrandTypes = jest.fn();
const mockGetActiveBooking = jest.fn();
const mockGetUnreadCount = jest.fn();
const mockGetBookings = jest.fn();
const mockGetWalletBalance = jest.fn();

jest.mock('../user.service', () => ({
  userService: {
    getCustomerHome: (...a: unknown[]) => mockGetCustomerHome(...a),
    getAddresses: jest.fn(() => Promise.resolve({ data: { data: [] } })),
    getTrustedContacts: jest.fn(() => Promise.resolve({ data: { data: [] } })),
    getReferral: jest.fn(() => Promise.resolve({ data: { data: null } })),
  },
}));
jest.mock('../config.service', () => ({
  configService: {
    getErrandTypes: (...a: unknown[]) => mockGetErrandTypes(...a),
    getPromos: jest.fn(() => Promise.resolve({ data: { data: [] } })),
  },
}));
jest.mock('../booking.service', () => ({
  bookingService: {
    getActiveBooking: (...a: unknown[]) => mockGetActiveBooking(...a),
    getBookings: (...a: unknown[]) => mockGetBookings(...a),
  },
}));
jest.mock('../payment.service', () => ({
  paymentService: {
    getWalletBalance: (...a: unknown[]) => mockGetWalletBalance(...a),
    getWalletTransactions: jest.fn(() => Promise.resolve({ data: { data: [] } })),
    getPaymentMethods: jest.fn(() => Promise.resolve({ data: { data: [] } })),
  },
}));
jest.mock('../notification.service', () => ({
  notificationService: {
    getUnreadCount: (...a: unknown[]) => mockGetUnreadCount(...a),
    getNotifications: jest.fn(() => Promise.resolve({ data: { data: [] } })),
  },
}));
jest.mock('../runner.service', () => ({ runnerService: {} }));
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

const USER = 'user-1';

const ERRAND_TYPES = [{ id: 't1', name: 'Delivery', is_active: true }];
const ACTIVE_BOOKING = { id: 'b-active', status: 'in_transit' };
const RECENT_BOOKINGS = [{ id: 'b1' }, { id: 'b2' }];
const PROMOS = [{ id: 'p1', code: 'SAVE10' }];
const REFERRAL = {
  referral_code: 'ABC123',
  share_link: 'https://errandguy.ph/r/ABC123',
  counts: { pending: 1, qualified: 2, rewarded: 3 },
  total_earned: 150,
};

const aggregate = (overrides: Record<string, unknown> = {}) => ({
  data: {
    data: {
      errand_types: ERRAND_TYPES,
      active_booking: ACTIVE_BOOKING,
      recent_bookings: RECENT_BOOKINGS,
      wallet_balance: 1234.5,
      promos: PROMOS,
      referral: REFERRAL,
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
  mockGetErrandTypes.mockResolvedValue({ data: { data: ERRAND_TYPES } });
  mockGetActiveBooking.mockResolvedValue({ data: { data: ACTIVE_BOOKING } });
  mockGetUnreadCount.mockReset().mockResolvedValue({ data: { data: { count: 0 } } });
  mockGetBookings.mockResolvedValue({ data: { data: RECENT_BOOKINGS } });
  mockGetWalletBalance.mockResolvedValue({ data: { data: { balance: 1234.5 } } });
  mockGetCustomerHome.mockResolvedValue(aggregate());
});

describe('preloadCustomerEssentials — /customer/home aggregate fan-out', () => {
  it('costs ONE round trip and fires none of the endpoints it replaces', async () => {
    await preloadCustomerEssentials(USER);
    await flush();

    expect(mockGetCustomerHome).toHaveBeenCalledTimes(1);
    // The five above-the-fold requests this aggregate stands in for.
    expect(mockGetErrandTypes).not.toHaveBeenCalled();
    expect(mockGetActiveBooking).not.toHaveBeenCalled();
    expect(mockGetWalletBalance).not.toHaveBeenCalled();
    // getBookings still runs ONCE — for the below-the-fold activity list, not
    // for the recent-bookings seed the aggregate now covers.
    expect(mockGetBookings).toHaveBeenCalledTimes(1);
    expect(mockGetBookings).toHaveBeenCalledWith({ page: 1, per_page: 15 });
  });

  it('seeds the exact useQuery keys, shapes and TTLs each screen reads', async () => {
    await preloadCustomerEssentials(USER);
    const w = writes();

    expect(w['q:errand-types']).toEqual({ value: ERRAND_TYPES, ttl: CacheTTL.STATIC });
    expect(w[`q:booking:active:${USER}`]).toEqual({
      value: ACTIVE_BOOKING,
      ttl: CacheTTL.SHORT,
    });
    expect(w[`q:bookings:recent:${USER}`]).toEqual({
      value: RECENT_BOOKINGS,
      ttl: CacheTTL.LONG,
    });
    expect(w[`q:promos:${USER}`]).toEqual({ value: PROMOS, ttl: CacheTTL.MEDIUM });
    expect(w[`q:user:referral:${USER}`]).toEqual({ value: REFERRAL, ttl: CacheTTL.MEDIUM });
  });

  it('seeds the wallet balance as a NUMBER, not the {balance} object', async () => {
    await preloadCustomerEssentials(USER);
    const entry = writes()[`q:wallet:balance:${USER}`];

    // The regression this guards: seeding the object rendered "₱[object Object]".
    expect(typeof entry.value).toBe('number');
    expect(entry.value).toBe(1234.5);
    expect(entry.ttl).toBe(CacheTTL.MEDIUM);
  });

  it('caches a genuine "no active errand" as null rather than skipping the key', async () => {
    mockGetCustomerHome.mockResolvedValue(aggregate({ active_booking: null }));

    await preloadCustomerEssentials(USER);

    expect(writes()[`q:booking:active:${USER}`]).toEqual({
      value: null,
      ttl: CacheTTL.SHORT,
    });
  });

  it('leaves the referral key a cache MISS when the server sends none', async () => {
    mockGetCustomerHome.mockResolvedValue(aggregate({ referral: null }));

    await preloadCustomerEssentials(USER);
    const w = writes();

    // Pinning null there would show an empty referral card for the whole
    // freshness window; a miss makes the screen fetch normally.
    expect(w[`q:user:referral:${USER}`]).toBeUndefined();
    // The rest of the snapshot still lands.
    expect(w[`q:wallet:balance:${USER}`].value).toBe(1234.5);
  });

  /**
   * The list key is read by THREE surfaces — the Home tab, the Profile tab and
   * (customer)/_layout, which uses it to pick the booking its realtime channel
   * follows. It was never seeded, so every cold start paid an extra
   * authenticated GET on the most-hit screen in the app while the snapshot it
   * needed was already in hand.
   */
  it('seeds the active-errand LIST, not just the singular', async () => {
    const list = [ACTIVE_BOOKING, { id: 'b-second', status: 'accepted' }];
    mockGetCustomerHome.mockResolvedValue(aggregate({ active_bookings: list }));

    await preloadCustomerEssentials(USER);

    expect(writes()[`q:bookings:active-list:${USER}`]).toEqual({
      value: list,
      ttl: CacheTTL.SHORT,
    });
  });

  it('seeds a genuine empty list, so Home does not fetch to learn there is nothing', async () => {
    mockGetCustomerHome.mockResolvedValue(
      aggregate({ active_bookings: [], active_booking: null }),
    );

    await preloadCustomerEssentials(USER);

    expect(writes()[`q:bookings:active-list:${USER}`]).toEqual({
      value: [],
      ttl: CacheTTL.SHORT,
    });
  });

  /**
   * An older API build omits the section entirely — which production is
   * currently running. Seeding an empty array there would pin "no active
   * errand" over a live one for the whole freshness window, so the key must
   * stay a MISS and let the screen fetch exactly as it does today.
   */
  it('leaves the list key a MISS when an older server omits the section', async () => {
    // The default fixture has no `active_bookings` at all.
    await preloadCustomerEssentials(USER);
    const w = writes();

    expect(w[`q:bookings:active-list:${USER}`]).toBeUndefined();
    // …and the rest of the snapshot still lands, including the singular.
    expect(w[`q:booking:active:${USER}`].value).toEqual(ACTIVE_BOOKING);
  });

  it('never lets a malformed section through as a seeded value', async () => {
    mockGetCustomerHome.mockResolvedValue(
      aggregate({ active_bookings: { nope: true } as unknown }),
    );

    await preloadCustomerEssentials(USER);

    expect(writes()[`q:bookings:active-list:${USER}`]).toBeUndefined();
  });

  it('still warms the below-the-fold set, unchanged', async () => {
    await preloadCustomerEssentials(USER);
    await flush();
    const w = writes();

    expect(w[`q:wallet:transactions:${USER}:all`]).toBeDefined();
    expect(w[`q:user:addresses:${USER}`]).toBeDefined();
    expect(w[`q:payment-methods:${USER}`]).toBeDefined();
    expect(w[`q:chat:conversations:${USER}`]).toBeDefined();
    expect(w[`q:bookings:activity:all:${USER}`]).toBeDefined();
  });

  /**
   * The unread badge is primed by a REQUEST, not a query-cache seed.
   *
   * useRealtimeNotifications never goes through useQuery — it calls
   * getUnreadCount() straight into the store and keeps it live over Reverb — so
   * the cache key the warm-up used to write was read by nothing. What actually
   * made the badge paint immediately is the side effect: getUnreadCount() is an
   * `api.get` with a 15s micro-cache, so the hook's own call on mount coalesces
   * onto this one. This asserts the useful half happens and the dead half
   * doesn't (the previous version of this test pinned the dead write).
   */
  it('primes the unread badge with a request, and writes no dead cache key', async () => {
    await preloadCustomerEssentials(USER);
    await flush();

    expect(mockGetUnreadCount).toHaveBeenCalled();
    expect(writes()[`q:notifications:unread:${USER}`]).toBeUndefined();
  });
});

describe('preloadCustomerEssentials — fallback when the aggregate is unusable', () => {
  const expectPerEndpointFallback = () => {
    expect(mockGetErrandTypes).toHaveBeenCalledTimes(1);
    expect(mockGetActiveBooking).toHaveBeenCalledTimes(1);
    expect(mockGetWalletBalance).toHaveBeenCalledTimes(1);
    expect(mockGetBookings).toHaveBeenCalledWith({ per_page: 5 });

    const w = writes();
    expect(w['q:errand-types']).toEqual({ value: ERRAND_TYPES, ttl: CacheTTL.STATIC });
    expect(w[`q:booking:active:${USER}`]).toEqual({
      value: ACTIVE_BOOKING,
      ttl: CacheTTL.SHORT,
    });
    expect(w[`q:bookings:recent:${USER}`]).toEqual({
      value: RECENT_BOOKINGS,
      ttl: CacheTTL.LONG,
    });
    // Still the number, on this path too.
    expect(w[`q:wallet:balance:${USER}`]).toEqual({ value: 1234.5, ttl: CacheTTL.MEDIUM });
  };

  it('degrades to the per-endpoint seeds when the request fails', async () => {
    mockGetCustomerHome.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }));

    await preloadCustomerEssentials(USER);
    await flush();

    expectPerEndpointFallback();
  });

  it('degrades when the endpoint does not exist (older server → 404 body)', async () => {
    mockGetCustomerHome.mockResolvedValue({ data: { message: 'Not Found' } });

    await preloadCustomerEssentials(USER);
    await flush();

    expectPerEndpointFallback();
  });

  it.each([
    ['a missing section', { active_booking: undefined }],
    ['a null list', { promos: null }],
    ['a non-numeric balance', { wallet_balance: { balance: 1234.5 } }],
  ])('degrades on a partial payload: %s', async (_label, bad) => {
    const payload = aggregate(bad);
    if ('active_booking' in bad && bad.active_booking === undefined) {
      delete (payload.data.data as Record<string, unknown>).active_booking;
    }
    mockGetCustomerHome.mockResolvedValue(payload);

    await preloadCustomerEssentials(USER);
    await flush();

    expectPerEndpointFallback();
  });

  it('never rejects, even when the fallback endpoints fail too', async () => {
    mockGetCustomerHome.mockRejectedValue(new Error('offline'));
    mockGetErrandTypes.mockRejectedValue(new Error('offline'));
    mockGetActiveBooking.mockRejectedValue(new Error('offline'));
    mockGetBookings.mockRejectedValue(new Error('offline'));
    mockGetWalletBalance.mockRejectedValue(new Error('offline'));

    await expect(preloadCustomerEssentials(USER)).resolves.toBeUndefined();
    await flush();

    // A failed fetch must not write a poisoned entry.
    expect(writes()['q:errand-types']).toBeUndefined();
  });
});
