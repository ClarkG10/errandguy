import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearAccountScopedState } from '../clearAccountScopedState';
import { addRecentRecipient, getRecentRecipients } from '../recentRecipients';
import { usePreferencesStore } from '../../stores/preferencesStore';

const SUPPORT_DRAFT_KEY = '@support_draft_v1';
const PAYMENT_MEMORY_KEY = '@last_payment_method_v1';

beforeEach(async () => {
  await AsyncStorage.clear();
  usePreferencesStore.setState({ lastPaymentMethods: {} });
});

describe('clearAccountScopedState — on-device PII', () => {
  it('wipes saved recipients for every account on the handset', async () => {
    // The account-switch call site runs with the INCOMING user already in the
    // auth store, so a teardown that cleared by "current" id would leave the
    // outgoing user's contacts behind.
    await addRecentRecipient('user-1', { name: 'Ana Cruz', phone: '09171111111' });
    await addRecentRecipient('user-2', { name: 'Ben Reyes', phone: '09172222222' });

    await clearAccountScopedState();

    await expect(getRecentRecipients('user-1')).resolves.toEqual([]);
    await expect(getRecentRecipients('user-2')).resolves.toEqual([]);
  });

  it('wipes the remembered payment selection but keeps device comfort prefs', async () => {
    usePreferencesStore.setState({ reduceHaptics: true });
    usePreferencesStore
      .getState()
      .setLastPaymentMethod('user-1', { id: '__gcash__', type: 'gcash' });

    await clearAccountScopedState();

    expect(usePreferencesStore.getState().lastPaymentMethods).toEqual({});
    await expect(AsyncStorage.getItem(PAYMENT_MEMORY_KEY)).resolves.toBeNull();
    expect(usePreferencesStore.getState().reduceHaptics).toBe(true);
  });

  it('wipes the unsent support ticket draft', async () => {
    await AsyncStorage.setItem(
      SUPPORT_DRAFT_KEY,
      JSON.stringify({
        userId: 'user-1',
        subject: 'Refund',
        category: 'payment',
        message: 'my number is 09171111111',
        savedAt: Date.now(),
      }),
    );

    await clearAccountScopedState();

    await expect(AsyncStorage.getItem(SUPPORT_DRAFT_KEY)).resolves.toBeNull();
  });

  it('never lets a storage failure block the sign-out', async () => {
    usePreferencesStore
      .getState()
      .setLastPaymentMethod('user-1', { id: '__gcash__', type: 'gcash' });
    const getAllKeys = jest
      .spyOn(AsyncStorage, 'getAllKeys')
      .mockRejectedValue(new Error('disk full'));

    await expect(clearAccountScopedState()).resolves.toBeUndefined();
    // The wipes that don't depend on the failing read still landed.
    expect(usePreferencesStore.getState().lastPaymentMethods).toEqual({});

    getAllKeys.mockRestore();
  });
});
