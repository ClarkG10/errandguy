import { act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// expo-crypto's randomUUID is a native module (unimplemented under jest) — give
// it a unique-per-call stub so idempotency keys are distinct.
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `uuid-${++n}` };
});

import {
  usePaymentStore,
  isAttemptActive,
  isAttemptTerminal,
} from '../paymentStore';

const STORAGE_KEY = '@payment_attempt_v1';

beforeEach(async () => {
  usePaymentStore.setState({ attempt: null, isHydrated: false });
  await AsyncStorage.clear();
});

describe('paymentStore', () => {
  it('mints a fresh attempt with an idempotency key and preparing status', () => {
    let key: string | undefined;
    act(() => {
      const a = usePaymentStore.getState().beginAttempt({ kind: 'topup', amount: 500 });
      key = a.idempotencyKey;
    });
    const a = usePaymentStore.getState().attempt!;
    expect(a).toBeTruthy();
    expect(a.kind).toBe('topup');
    expect(a.amount).toBe(500);
    expect(a.status).toBe('preparing');
    expect(a.idempotencyKey).toBeTruthy();
    expect(a.attemptId).toBeTruthy();
    expect(a.idempotencyKey).toBe(key);
  });

  it('mints a DIFFERENT key for each new attempt', () => {
    let k1 = '';
    let k2 = '';
    act(() => {
      k1 = usePaymentStore.getState().beginAttempt({ kind: 'booking', amount: 100 }).idempotencyKey;
    });
    act(() => {
      k2 = usePaymentStore.getState().beginAttempt({ kind: 'booking', amount: 100 }).idempotencyKey;
    });
    expect(k1).not.toBe(k2);
  });

  it('reuses the SAME key across status changes of one attempt (retry-safe)', () => {
    let key = '';
    act(() => {
      key = usePaymentStore.getState().beginAttempt({ kind: 'topup', amount: 300 }).idempotencyKey;
    });
    act(() => usePaymentStore.getState().linkPayment('pay_1'));
    act(() => usePaymentStore.getState().setStatus('verifying', { reference: 'inv_1' }));
    const a = usePaymentStore.getState().attempt!;
    expect(a.idempotencyKey).toBe(key); // unchanged → backend dedupes a retry
    expect(a.paymentId).toBe('pay_1');
    expect(a.reference).toBe('inv_1');
    expect(a.status).toBe('verifying');
  });

  it('tracks active vs terminal correctly', () => {
    act(() => usePaymentStore.getState().beginAttempt({ kind: 'topup', amount: 50 }));
    expect(isAttemptActive(usePaymentStore.getState().attempt)).toBe(true);
    expect(isAttemptTerminal(usePaymentStore.getState().attempt)).toBe(false);

    act(() => usePaymentStore.getState().setStatus('success'));
    expect(isAttemptActive(usePaymentStore.getState().attempt)).toBe(false);
    expect(isAttemptTerminal(usePaymentStore.getState().attempt)).toBe(true);
  });

  it('resolve clears the attempt', () => {
    act(() => usePaymentStore.getState().beginAttempt({ kind: 'booking', amount: 100 }));
    act(() => usePaymentStore.getState().resolve());
    expect(usePaymentStore.getState().attempt).toBeNull();
    expect(isAttemptActive(usePaymentStore.getState().attempt)).toBe(false);
  });

  it('loadFromStorage drops a rehydrated preparing attempt (unresumable — would lock out payments)', async () => {
    // A 'preparing' attempt was persisted before the create response returned
    // (e.g. the app was force-quit mid-create). It holds no server reference,
    // so it can never advance or verify — keeping it would hold the
    // one-payment lock forever and silently block every booking AND top-up.
    const now = Date.now();
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        attemptId: 'a1', idempotencyKey: 'k1', kind: 'booking',
        amount: 100, status: 'preparing', startedAt: now, updatedAt: now,
      }),
    );

    await act(async () => {
      await usePaymentStore.getState().loadFromStorage();
    });

    expect(usePaymentStore.getState().attempt).toBeNull();
    expect(usePaymentStore.getState().isHydrated).toBe(true);
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('loadFromStorage KEEPS a resumable non-terminal attempt so verification continues', async () => {
    const now = Date.now();
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        attemptId: 'a2', idempotencyKey: 'k2', kind: 'booking', paymentId: 'pay_9',
        amount: 250, status: 'verifying', startedAt: now, updatedAt: now,
      }),
    );

    await act(async () => {
      await usePaymentStore.getState().loadFromStorage();
    });

    const a = usePaymentStore.getState().attempt;
    expect(a).toBeTruthy();
    expect(a!.status).toBe('verifying');
    expect(a!.paymentId).toBe('pay_9');
  });
});
