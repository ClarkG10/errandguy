/**
 * The panic button's durability contract.
 *
 * What must hold, and why each one is here:
 *   • a dead-zone press is PERSISTED, not lost — the whole point;
 *   • it retries until the server ACKs, on a timer and on reconnect, because
 *     the emergency case includes flaky signal (a timeout with the network
 *     store still saying "online" crosses no offline→online edge);
 *   • a stand-down DROPS the queued intent BEFORE anything else, or the replay
 *     re-raises an alarm the user already cancelled — the one way a retry loop
 *     can do harm;
 *   • a 4xx (errand closed → SOSController findOrFail 404) is final, never
 *     replayed;
 *   • an intent older than an hour is abandoned rather than replayed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearSosIntent,
  describeSosFailure,
  raiseSos,
  resumeSosIntent,
  retryNow,
  standDownSos,
  useSosIntentStore,
  MAX_INTENT_AGE_MS,
} from '../sosIntent';
import { useNetworkStore } from '../../stores/networkStore';

const mockCustomerSos = jest.fn();
const mockRunnerSos = jest.fn();

const mockCustomerStandDown = jest.fn();
const mockRunnerStandDown = jest.fn();

jest.mock('../booking.service', () => ({
  bookingService: {
    triggerSOS: (...a: unknown[]) => mockCustomerSos(...a),
    deactivateSOS: (...a: unknown[]) => mockCustomerStandDown(...a),
  },
}));
jest.mock('../runner.service', () => ({
  runnerService: {
    triggerSOS: (...a: unknown[]) => mockRunnerSos(...a),
    deactivateSOS: (...a: unknown[]) => mockRunnerStandDown(...a),
  },
}));

const STORAGE_KEY = '@sos_intent_v1';
const state = () => useSosIntentStore.getState();
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useRealTimers();
  useNetworkStore.setState({ isOffline: false, lastChangedAt: null });
  await AsyncStorage.clear();
  await clearSosIntent();
  mockCustomerSos.mockResolvedValue({
    data: { data: { id: 'alert-1', contacts_notified: ['c1', 'c2'] } },
  });
  mockRunnerSos.mockResolvedValue({ data: { data: { id: 'alert-2' } } });
  mockCustomerStandDown.mockResolvedValue({ data: {} });
  mockRunnerStandDown.mockResolvedValue({ data: {} });
});

afterEach(async () => {
  await clearSosIntent();
});

describe('raiseSos — happy path', () => {
  it('sends immediately and reports the contacts the server recorded', async () => {
    const res = await raiseSos('bk-1', 'customer');
    expect(res).toEqual({ status: 'sent', contacts: ['c1', 'c2'] });
    expect(mockCustomerSos).toHaveBeenCalledWith('bk-1', { timeoutMs: 8000 });
    // Nothing left queued, nothing left on disk.
    expect(state().intent).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(state().lastAck?.bookingId).toBe('bk-1');
  });

  it('routes the runner role to the runner endpoint', async () => {
    await raiseSos('bk-9', 'runner');
    expect(mockRunnerSos).toHaveBeenCalledWith('bk-9', { timeoutMs: 8000 });
    expect(mockCustomerSos).not.toHaveBeenCalled();
  });
});

describe('raiseSos — no signal', () => {
  it('persists the intent and reports "queued" instead of throwing it away', async () => {
    mockCustomerSos.mockRejectedValue({ status: 0, kind: 'offline' });
    const res = await raiseSos('bk-2', 'customer');
    expect(res.status).toBe('queued');
    expect(state().intent).toMatchObject({ bookingId: 'bk-2', role: 'customer', attempts: 1 });
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw as string)).toMatchObject({ bookingId: 'bk-2' });
  });

  it('a manual retry that succeeds ACKs and clears the queue', async () => {
    mockCustomerSos.mockRejectedValueOnce({ status: 0, kind: 'offline' });
    await raiseSos('bk-3', 'customer');
    expect(state().intent).not.toBeNull();

    retryNow();
    await flush();

    expect(mockCustomerSos).toHaveBeenCalledTimes(2);
    expect(state().intent).toBeNull();
    expect(state().lastAck?.bookingId).toBe('bk-3');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('replays on the offline→online edge — the reconnect case', async () => {
    mockCustomerSos.mockRejectedValueOnce({ status: 0, kind: 'offline' });
    await raiseSos('bk-4', 'customer');
    useNetworkStore.setState({ isOffline: true, lastChangedAt: Date.now() });

    // Signal comes back.
    useNetworkStore.getState().setOffline(false);
    await flush();

    expect(mockCustomerSos).toHaveBeenCalledTimes(2);
    expect(state().intent).toBeNull();
  });

  it('retries on its own timer — a flaky-signal timeout crosses no offline edge', async () => {
    jest.useFakeTimers();
    mockCustomerSos.mockRejectedValueOnce({ status: 0, kind: 'timeout' });
    const first = raiseSos('bk-5', 'customer');
    await Promise.resolve();
    await first;
    expect(mockCustomerSos).toHaveBeenCalledTimes(1);
    // The network store never flipped: only the loop's own timer can save this.
    expect(useNetworkStore.getState().isOffline).toBe(false);

    jest.advanceTimersByTime(4_000);
    jest.useRealTimers();
    await flush();

    expect(mockCustomerSos).toHaveBeenCalledTimes(2);
    expect(state().intent).toBeNull();
  });
});

describe('raiseSos — the server says no', () => {
  it('drops a 4xx outright (booking closed → 404) and never replays it', async () => {
    mockCustomerSos.mockRejectedValue({ status: 404, kind: 'not_found' });
    const res = await raiseSos('bk-6', 'customer');
    expect(res.status).toBe('rejected');
    expect(state().intent).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(state().lastRejection?.bookingId).toBe('bk-6');

    retryNow();
    await flush();
    expect(mockCustomerSos).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying a 429 / 5xx — those are not verdicts', async () => {
    mockCustomerSos.mockRejectedValueOnce({ status: 429, kind: 'rate_limited' });
    await raiseSos('bk-7', 'customer');
    expect(state().intent).not.toBeNull();

    mockCustomerSos.mockRejectedValueOnce({ status: 503, kind: 'server' });
    retryNow();
    await flush();
    expect(state().intent).not.toBeNull();
  });
});

describe('standDownSos', () => {
  it('drops the queued intent so a replay cannot re-raise a cancelled alarm', async () => {
    mockCustomerSos.mockRejectedValue({ status: 0, kind: 'offline' });
    await raiseSos('bk-8', 'customer');
    expect(state().intent).not.toBeNull();

    const { hadUnsentIntent } = standDownSos('bk-8');
    expect(hadUnsentIntent).toBe(true);
    expect(state().intent).toBeNull();

    // Every replay trigger is now a no-op: nothing to send.
    retryNow();
    useNetworkStore.setState({ isOffline: true, lastChangedAt: Date.now() });
    useNetworkStore.getState().setOffline(false);
    await flush();
    expect(mockCustomerSos).toHaveBeenCalledTimes(1); // just the original press
  });

  it('reports nothing queued when the raise had already been acknowledged', async () => {
    await raiseSos('bk-10', 'customer');
    expect(standDownSos('bk-10')).toEqual({ hadUnsentIntent: false });
    expect(state().lastAck).toBeNull();
  });

  it('leaves another booking’s queued intent alone', async () => {
    mockCustomerSos.mockRejectedValue({ status: 0, kind: 'offline' });
    await raiseSos('bk-11', 'customer');
    const { hadUnsentIntent } = standDownSos('bk-other');
    expect(hadUnsentIntent).toBe(false);
    expect(state().intent?.bookingId).toBe('bk-11');
  });

  it('cancels for real when the user stands down MID-attempt', async () => {
    // The one race a retry loop can still lose: "I'm safe" is pressed while an
    // attempt is on the wire, so the alert is created a moment AFTER the user
    // thought they'd cancelled it. It must never surface as active, and the
    // now-real alert has to be stood down on the server.
    const deferred: { release?: (v: unknown) => void } = {};
    mockCustomerSos.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deferred.release = resolve;
        }),
    );
    const raise = raiseSos('bk-14', 'customer');
    await flush();

    standDownSos('bk-14');
    deferred.release?.({
      data: { data: { id: 'alert-14', contacts_notified: ['c1'] } },
    });
    const res = await raise;

    expect(res.status).toBe('rejected');
    expect(state().lastAck).toBeNull(); // never shown as "SOS active"
    expect(mockCustomerStandDown).toHaveBeenCalledWith('bk-14');
    expect(state().intent).toBeNull();
  });

  it('does not suppress a NEW press made after a stand-down', async () => {
    mockCustomerSos.mockRejectedValueOnce({ status: 0, kind: 'offline' });
    await raiseSos('bk-15', 'customer');
    standDownSos('bk-15');

    const res = await raiseSos('bk-15', 'customer');
    expect(res.status).toBe('sent');
    expect(state().lastAck?.bookingId).toBe('bk-15');
  });
});

describe('describeSosFailure', () => {
  it('explains a closed errand instead of leaking a findOrFail message', () => {
    const msg = describeSosFailure({
      status: 404,
      kind: 'not_found',
      message: 'No query results for model [App\\Models\\Booking] bk-1',
    });
    expect(msg).toContain('This errand is closed');
    expect(msg).toContain('911');
    expect(msg).not.toContain('No query results');
  });

  it('keeps the safety copy for an abandoned (offline) intent', () => {
    const msg = describeSosFailure({ status: 0, kind: 'offline', message: 'Network error.' });
    expect(msg).toContain('call for help directly');
  });
});

describe('resumeSosIntent', () => {
  it('picks up an intent persisted before an app kill and re-sends it', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        bookingId: 'bk-12',
        role: 'runner',
        triggeredAt: Date.now() - 30_000,
        attempts: 1,
        lastAttemptAt: Date.now() - 30_000,
      }),
    );

    await resumeSosIntent();
    await flush();

    expect(mockRunnerSos).toHaveBeenCalledWith('bk-12', { timeoutMs: 8000 });
    expect(state().intent).toBeNull();
  });

  it('abandons an intent older than the max age rather than raising a stale alarm', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        bookingId: 'bk-13',
        role: 'customer',
        triggeredAt: Date.now() - MAX_INTENT_AGE_MS - 1_000,
        attempts: 3,
        lastAttemptAt: Date.now() - 60_000,
      }),
    );

    const resumed = await resumeSosIntent();
    await flush();

    expect(resumed).toBeNull();
    expect(mockCustomerSos).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('survives a corrupt payload without touching the emergency path', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(resumeSosIntent()).resolves.toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
