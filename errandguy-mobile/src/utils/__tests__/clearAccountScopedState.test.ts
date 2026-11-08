import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearAccountScopedState } from '../clearAccountScopedState';
import { addRecentRecipient, getRecentRecipients } from '../recentRecipients';
import { usePreferencesStore } from '../../stores/preferencesStore';

const SUPPORT_DRAFT_KEY = '@support_draft_v1';
const PAYMENT_MEMORY_KEY = '@last_payment_method_v1';
const TRUSTED_CONTACTS_KEY = '@trusted_contacts_cache';

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

  /**
   * The sharpest of these: the trusted-contacts cache carries no user id, so
   * the next account on the handset doesn't merely inherit a stale copy — it
   * can read the previous customer's emergency contacts directly.
   */
  it('wipes the trusted-contacts cache, which is not keyed by user', async () => {
    await AsyncStorage.setItem(
      TRUSTED_CONTACTS_KEY,
      JSON.stringify([{ id: 'tc1', name: 'Ana Cruz', phone: '09171111111', priority: 1 }]),
    );

    await clearAccountScopedState();

    await expect(AsyncStorage.getItem(TRUSTED_CONTACTS_KEY)).resolves.toBeNull();
  });

  it('wipes the remembered payment selection but keeps device comfort prefs', async () => {
    usePreferencesStore.setState({ reduceHaptics: true });
    usePreferencesStore
      .getState()
      .setLastPaymentMethod('user-1', 'gcash');

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
      .setLastPaymentMethod('user-1', 'gcash');
    const getAllKeys = jest
      .spyOn(AsyncStorage, 'getAllKeys')
      .mockRejectedValue(new Error('disk full'));

    await expect(clearAccountScopedState()).resolves.toBeUndefined();
    // The wipes that don't depend on the failing read still landed.
    expect(usePreferencesStore.getState().lastPaymentMethods).toEqual({});

    getAllKeys.mockRestore();
  });
});

describe('clearAccountScopedState — in-memory money and messages', () => {
  it('drops the wallet balance and transactions', async () => {
    const { useWalletStore } = require('../../stores/walletStore');
    useWalletStore.setState({
      balance: 1520,
      transactions: [{ id: 'tx-1', amount: 1520, balance_after: 1520 }],
    });

    await clearAccountScopedState();

    expect(useWalletStore.getState().balance).toBe(0);
    expect(useWalletStore.getState().transactions).toEqual([]);
  });

  it('drops loaded threads and the Messages badge', async () => {
    const { useChatStore } = require('../../stores/chatStore');
    useChatStore.setState({
      messages: { 'bk-1': [{ id: 'm1', content: 'hi', created_at: '2026-01-01T00:00:00Z' }] },
      unreadCount: 3,
      unreadByBooking: { 'bk-1': 3 },
    });

    await clearAccountScopedState();

    expect(useChatStore.getState().messages).toEqual({});
    expect(useChatStore.getState().unreadCount).toBe(0);
    expect(useChatStore.getState().unreadByBooking).toEqual({});
  });

  it("forgets which messages were already counted, so the next account's badge counts", async () => {
    const { useChatStore } = require('../../stores/chatStore');
    const message = { id: 'm-9', sender_id: 'other', read_at: null, created_at: '2026-01-01T00:00:00Z' };
    useChatStore.getState().noteIncomingMessage('bk-1', message, 'me');

    await clearAccountScopedState();
    useChatStore.getState().noteIncomingMessage('bk-1', message, 'me');

    expect(useChatStore.getState().unreadByBooking['bk-1']).toBe(1);
  });
});
