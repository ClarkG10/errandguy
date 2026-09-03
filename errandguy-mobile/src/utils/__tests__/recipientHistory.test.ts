import AsyncStorage from '@react-native-async-storage/async-storage';
import { CacheService, CacheTTL } from '../../services/cache.service';
import {
  deriveRecipientsFromBookings,
  readCachedRecentBookings,
  type RecipientSource,
} from '../recipientHistory';
import {
  getRecentRecipients,
  addRecentRecipient,
  normalizePhPhone,
  seedRecipientsFromHistory,
} from '../recentRecipients';

const USER = 'user-1';
const KEY = '@errandguy:recent_recipients:user-1';

/** Exactly what useQuery(['bookings','recent',userId]) leaves on the device. */
const seedCache = (userId: string, bookings: RecipientSource[]) =>
  CacheService.set(
    `q:bookings:recent:${userId}`,
    { value: bookings, fetchedAt: Date.now() },
    CacheTTL.LONG,
  );

const booking = (
  createdAt: string,
  overrides: Partial<RecipientSource> = {},
): RecipientSource => ({
  created_at: createdAt,
  pickup_contact_name: null,
  pickup_contact_phone: null,
  dropoff_contact_name: null,
  dropoff_contact_phone: null,
  ...overrides,
});

const derive = (bookings: RecipientSource[] | null | undefined, cap = 3) =>
  deriveRecipientsFromBookings(bookings, {
    cap,
    normalize: normalizePhPhone,
    identity: normalizePhPhone,
  });

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('deriveRecipientsFromBookings', () => {
  it('takes both contacts of a booking, pickup first', () => {
    expect(
      derive([
        booking('2026-09-01T10:00:00Z', {
          pickup_contact_name: 'Ana Cruz',
          pickup_contact_phone: '0917 111 1111',
          dropoff_contact_name: 'Ben Reyes',
          dropoff_contact_phone: '+63 917 222 2222',
        }),
      ]),
    ).toEqual([
      { name: 'Ana Cruz', phone: '09171111111' },
      { name: 'Ben Reyes', phone: '09172222222' },
    ]);
  });

  it('orders newest booking first regardless of the incoming order', () => {
    const list = derive([
      booking('2026-08-01T10:00:00Z', {
        dropoff_contact_name: 'Old',
        dropoff_contact_phone: '09170000001',
      }),
      booking('2026-09-01T10:00:00Z', {
        dropoff_contact_name: 'New',
        dropoff_contact_phone: '09170000002',
      }),
    ]);
    expect(list.map((r) => r.name)).toEqual(['New', 'Old']);
  });

  it('dedupes on the normalised number and keeps the newest name for it', () => {
    const list = derive([
      booking('2026-09-01T10:00:00Z', {
        dropoff_contact_name: 'Ana R. Cruz',
        dropoff_contact_phone: '+639171111111',
      }),
      booking('2026-08-01T10:00:00Z', {
        dropoff_contact_name: 'Ana',
        dropoff_contact_phone: '0917-111-1111',
      }),
    ]);
    expect(list).toEqual([{ name: 'Ana R. Cruz', phone: '09171111111' }]);
  });

  it('ignores half-filled pairs and junk numbers', () => {
    expect(
      derive([
        booking('2026-09-01T10:00:00Z', {
          pickup_contact_name: 'No number',
          dropoff_contact_phone: '09173333333',
        }),
        booking('2026-08-30T10:00:00Z', {
          dropoff_contact_name: 'Junk',
          dropoff_contact_phone: 'call me',
        }),
      ]),
    ).toEqual([]);
  });

  it('never returns more than the cap', () => {
    const list = derive(
      [
        booking('2026-09-03T10:00:00Z', {
          pickup_contact_name: 'A',
          pickup_contact_phone: '09170000001',
          dropoff_contact_name: 'B',
          dropoff_contact_phone: '09170000002',
        }),
        booking('2026-09-02T10:00:00Z', {
          pickup_contact_name: 'C',
          pickup_contact_phone: '09170000003',
          dropoff_contact_name: 'D',
          dropoff_contact_phone: '09170000004',
        }),
      ],
      3,
    );
    expect(list.map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });

  it('is safe on empty / missing input', () => {
    expect(derive(null)).toEqual([]);
    expect(derive([])).toEqual([]);
    expect(derive([booking('2026-09-01T10:00:00Z')])).toEqual([]);
  });
});

describe('readCachedRecentBookings', () => {
  it('reads the window useQuery already cached for this user', async () => {
    await seedCache(USER, [
      booking('2026-09-01T10:00:00Z', {
        dropoff_contact_name: 'Ana',
        dropoff_contact_phone: '09171111111',
      }),
    ]);
    const list = await readCachedRecentBookings(USER);
    expect(list).toHaveLength(1);
    expect(list?.[0].dropoff_contact_name).toBe('Ana');
  });

  it('returns null with no cache, and never reads an anon/absent id', async () => {
    await expect(readCachedRecentBookings(USER)).resolves.toBeNull();
    await seedCache('anon', [
      booking('2026-09-01T10:00:00Z', {
        dropoff_contact_name: 'Ana',
        dropoff_contact_phone: '09171111111',
      }),
    ]);
    await expect(readCachedRecentBookings('anon')).resolves.toBeNull();
    await expect(readCachedRecentBookings(null)).resolves.toBeNull();
  });
});

describe('getRecentRecipients — reinstall seeding', () => {
  it('seeds from the account booking window when the device has nothing', async () => {
    await seedCache(USER, [
      booking('2026-09-01T10:00:00Z', {
        dropoff_contact_name: 'Ana Cruz',
        dropoff_contact_phone: '0917 111 1111',
      }),
    ]);

    await expect(getRecentRecipients(USER)).resolves.toEqual([
      { name: 'Ana Cruz', phone: '09171111111' },
    ]);

    // Written back, so later reads are local again — even once the query
    // cache entry is gone.
    await CacheService.remove(`q:bookings:recent:${USER}`);
    const stored = await AsyncStorage.getItem(KEY);
    expect(JSON.parse(stored ?? 'null')).toEqual([
      { name: 'Ana Cruz', phone: '09171111111' },
    ]);
  });

  it('leaves an existing device list alone', async () => {
    await addRecentRecipient(USER, { name: 'Local', phone: '09179999999' });
    await seedCache(USER, [
      booking('2026-09-01T10:00:00Z', {
        dropoff_contact_name: 'From history',
        dropoff_contact_phone: '09171111111',
      }),
    ]);
    await expect(getRecentRecipients(USER)).resolves.toEqual([
      { name: 'Local', phone: '09179999999' },
    ]);
  });

  it('never seeds one account from another account window', async () => {
    await seedCache('user-2', [
      booking('2026-09-01T10:00:00Z', {
        dropoff_contact_name: 'Someone else',
        dropoff_contact_phone: '09171111111',
      }),
    ]);
    await expect(getRecentRecipients(USER)).resolves.toEqual([]);
    await expect(getRecentRecipients(null)).resolves.toEqual([]);
  });

  it('seeds nothing when the window holds no usable contact', async () => {
    await seedCache(USER, [booking('2026-09-01T10:00:00Z')]);
    await expect(seedRecipientsFromHistory(USER)).resolves.toEqual([]);
    await expect(AsyncStorage.getItem(KEY)).resolves.toBeNull();
  });
});
