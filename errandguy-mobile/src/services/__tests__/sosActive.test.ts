/**
 * The "SOS active" card's memory.
 *
 * What must hold:
 *   • an acknowledged alert outlives the screen that raised it (and an app
 *     restart) — leaving and reopening must not drop "I'm safe";
 *   • staff closing it (an `sos` notification with status `resolved`) flips it
 *     to closed, with the time — and nothing else does (an `active` banner
 *     about the OTHER person's alert is not ours);
 *   • a fresh read with `sos_triggered === false` closes it, but a read taken
 *     inside the grace window (a micro-cached or pre-SOS snapshot) cannot;
 *   • logout forgets every record.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  STORAGE_KEY,
  MAX_RECORD_AGE_MS,
  RECONCILE_GRACE_MS,
  clearAllSosActive,
  clearSosActive,
  hydrateSosActive,
  markSosResolved,
  noteSosNotification,
  reconcileSosActive,
  recordSosActive,
  resetSosActiveForTests,
  useSosActiveStore,
} from '../sosActive';

const records = () => useSosActiveStore.getState().records;
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(async () => {
  await AsyncStorage.clear();
  resetSosActiveForTests();
});

const raise = (bookingId = 'bk-1', role: 'customer' | 'runner' = 'customer') =>
  recordSosActive({ bookingId, role, alertedLine: null, contacts: [] });

describe('recordSosActive', () => {
  it('persists the acknowledged alert so a remount (or restart) gets it back', async () => {
    raise('bk-1', 'runner');
    await flush();

    // Simulate a cold start: memory gone, disk kept.
    resetSosActiveForTests();
    expect(records()['bk-1']).toBeUndefined();
    await hydrateSosActive();

    expect(records()['bk-1']).toMatchObject({
      bookingId: 'bk-1',
      role: 'runner',
      resolvedAt: null,
    });
  });

  it('keeps the original time on an idempotent replay, so the clock does not restart', () => {
    raise('bk-1');
    const first = records()['bk-1'].acknowledgedAt;
    jest.spyOn(Date, 'now').mockReturnValue(first + 60_000);
    raise('bk-1');
    expect(records()['bk-1'].acknowledgedAt).toBe(first);
    jest.restoreAllMocks();
  });

  it('a record written during boot survives the stored copy loading after it', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({}));
    raise('bk-2');
    await hydrateSosActive();
    expect(records()['bk-2']).toBeDefined();
  });

  it('a raise acknowledged before hydration never wipes the other stored records', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        'bk-old': {
          bookingId: 'bk-old',
          role: 'customer',
          acknowledgedAt: Date.now() - 60_000,
          alertedLine: null,
          contacts: [],
          resolvedAt: null,
          resolvedBy: null,
        },
      }),
    );
    raise('bk-new');
    await hydrateSosActive();
    await flush();
    const onDisk = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) as string);
    expect(Object.keys(onDisk).sort()).toEqual(['bk-new', 'bk-old']);
  });

  it('drops a day-old record on load and survives a corrupt payload', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        old: {
          bookingId: 'old',
          role: 'customer',
          acknowledgedAt: Date.now() - MAX_RECORD_AGE_MS - 1,
          alertedLine: null,
          contacts: [],
          resolvedAt: null,
          resolvedBy: null,
        },
      }),
    );
    await hydrateSosActive();
    expect(records().old).toBeUndefined();

    resetSosActiveForTests();
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(hydrateSosActive()).resolves.toBeUndefined();
    expect(records()).toEqual({});
  });
});

describe('closing the alert', () => {
  it('this device’s stand-down removes the record (disk too)', async () => {
    raise('bk-1');
    clearSosActive('bk-1');
    await flush();
    expect(records()['bk-1']).toBeUndefined();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('staff resolving it flips the card to closed, stamped with the notification time', async () => {
    raise('bk-1');
    await noteSosNotification({
      type: 'sos',
      data: { type: 'sos', booking_id: 'bk-1', status: 'resolved' },
      created_at: '2026-10-31T07:42:00Z',
    });
    expect(records()['bk-1']).toMatchObject({
      resolvedBy: 'staff',
      resolvedAt: Date.parse('2026-10-31T07:42:00Z'),
    });
  });

  it('ignores an ACTIVE banner (someone else’s alert) and other errands', async () => {
    raise('bk-1');
    await noteSosNotification({
      type: 'sos',
      data: { booking_id: 'bk-1', status: 'active', triggered_by_role: 'customer' },
    });
    await noteSosNotification({
      type: 'sos',
      data: { booking_id: 'bk-other', status: 'resolved' },
    });
    await noteSosNotification({ type: 'booking_update', data: { booking_id: 'bk-1', status: 'resolved' } });
    expect(records()['bk-1'].resolvedAt).toBeNull();
    expect(records()['bk-other']).toBeUndefined();
  });

  it('a fresh read with sos_triggered false closes it — but only after the grace window', () => {
    raise('bk-1');
    const ack = records()['bk-1'].acknowledgedAt;

    // A read from right after the raise can be a pre-SOS snapshot.
    reconcileSosActive('bk-1', false, ack + RECONCILE_GRACE_MS - 1);
    expect(records()['bk-1'].resolvedAt).toBeNull();

    // true may be the OTHER person's alert; missing is a masked/older payload.
    reconcileSosActive('bk-1', true, ack + RECONCILE_GRACE_MS + 5_000);
    reconcileSosActive('bk-1', undefined, ack + RECONCILE_GRACE_MS + 5_000);
    expect(records()['bk-1'].resolvedAt).toBeNull();

    reconcileSosActive('bk-1', false, ack + RECONCILE_GRACE_MS + 5_000);
    expect(records()['bk-1']).toMatchObject({ resolvedBy: 'server' });
  });

  it('a new raise after a close is live again', () => {
    raise('bk-1');
    markSosResolved('bk-1', 'staff');
    raise('bk-1');
    expect(records()['bk-1']).toMatchObject({ resolvedAt: null, resolvedBy: null });
  });
});

describe('logout', () => {
  it('forgets every record', async () => {
    raise('bk-1');
    raise('bk-2', 'runner');
    await clearAllSosActive();
    expect(records()).toEqual({});
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
