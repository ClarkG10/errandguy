import { act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { usePreferencesStore } from '../preferencesStore';

const STORAGE_KEY = '@appearance_prefs_v1';
const PAYMENT_MEMORY_KEY = '@last_payment_method_v1';

/** Reset to the module's declared defaults (the store self-hydrates on import,
 *  so every test has to put it back to a known pre-hydration state itself). */
const reset = async () => {
  usePreferencesStore.setState({
    reduceHaptics: false,
    reduceMotionOverride: false,
    isHydrated: false,
    lastPaymentMethods: {},
  });
  await AsyncStorage.clear();
};

beforeEach(reset);

describe('preferencesStore — appearance', () => {
  it('persists reduceHaptics without touching the payment memory blob', async () => {
    act(() => usePreferencesStore.getState().setReduceHaptics(true));

    expect(usePreferencesStore.getState().reduceHaptics).toBe(true);
    expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY))!)).toEqual({
      reduceHaptics: true,
      reduceMotionOverride: false,
    });
    // Account-scoped memory must NOT ride along in the device-comfort blob.
    expect(await AsyncStorage.getItem(PAYMENT_MEMORY_KEY)).toBeNull();
  });

  it('hydrates stored appearance prefs over the defaults', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ reduceMotionOverride: true }),
    );

    await act(async () => {
      await usePreferencesStore.getState().loadFromStorage();
    });

    const s = usePreferencesStore.getState();
    expect(s.reduceMotionOverride).toBe(true);
    // Key absent from the stored blob still resolves to its default.
    expect(s.reduceHaptics).toBe(false);
    expect(s.isHydrated).toBe(true);
  });

  it('falls back to defaults on a corrupt appearance blob', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');

    await act(async () => {
      await usePreferencesStore.getState().loadFromStorage();
    });

    expect(usePreferencesStore.getState().reduceHaptics).toBe(false);
    expect(usePreferencesStore.getState().isHydrated).toBe(true);
  });
});

describe('preferencesStore — last-used payment memory', () => {
  it('records the selection per user id and persists it', async () => {
    act(() =>
      usePreferencesStore
        .getState()
        .setLastPaymentMethod('user-1', { id: '__gcash__', type: 'gcash' }),
    );

    const entry = usePreferencesStore.getState().lastPaymentMethods['user-1'];
    expect(entry).toMatchObject({ id: '__gcash__', type: 'gcash' });
    expect(typeof entry.savedAt).toBe('number');

    const persisted = JSON.parse((await AsyncStorage.getItem(PAYMENT_MEMORY_KEY))!);
    expect(persisted['user-1']).toMatchObject({ id: '__gcash__', type: 'gcash' });
  });

  it('keeps two accounts on one device separate', () => {
    act(() => {
      usePreferencesStore
        .getState()
        .setLastPaymentMethod('user-1', { id: '__gcash__', type: 'gcash' });
      usePreferencesStore
        .getState()
        .setLastPaymentMethod('user-2', { id: 'pm-77', type: 'card' });
    });

    const map = usePreferencesStore.getState().lastPaymentMethods;
    expect(map['user-1'].id).toBe('__gcash__');
    expect(map['user-2'].id).toBe('pm-77');
  });

  it('overwrites the same user rather than accumulating', () => {
    act(() => {
      usePreferencesStore
        .getState()
        .setLastPaymentMethod('user-1', { id: '__cash__', type: 'cash' });
      usePreferencesStore
        .getState()
        .setLastPaymentMethod('user-1', { id: '__maya__', type: 'maya' });
    });

    const map = usePreferencesStore.getState().lastPaymentMethods;
    expect(Object.keys(map)).toEqual(['user-1']);
    expect(map['user-1']).toMatchObject({ id: '__maya__', type: 'maya' });
  });

  it('ignores a write with no user id or an incomplete method', async () => {
    act(() => {
      usePreferencesStore
        .getState()
        .setLastPaymentMethod('', { id: '__gcash__', type: 'gcash' });
      usePreferencesStore
        .getState()
        .setLastPaymentMethod('user-1', { id: '', type: 'gcash' });
    });

    expect(usePreferencesStore.getState().lastPaymentMethods).toEqual({});
    expect(await AsyncStorage.getItem(PAYMENT_MEMORY_KEY)).toBeNull();
  });

  it('hydrates the memory in the same tick that flips isHydrated', async () => {
    // PaymentMethodSelector gates its one-shot auto-pick on isHydrated, so a
    // map that lands a tick later would be missed entirely.
    await AsyncStorage.setItem(
      PAYMENT_MEMORY_KEY,
      JSON.stringify({ 'user-1': { id: '__maya__', type: 'maya', savedAt: 1 } }),
    );

    await act(async () => {
      await usePreferencesStore.getState().loadFromStorage();
    });

    const s = usePreferencesStore.getState();
    expect(s.isHydrated).toBe(true);
    expect(s.lastPaymentMethods['user-1']).toMatchObject({
      id: '__maya__',
      type: 'maya',
    });
  });

  it('starts empty on a corrupt or legacy-shaped memory blob', async () => {
    await AsyncStorage.setItem(PAYMENT_MEMORY_KEY, JSON.stringify(['__gcash__']));

    await act(async () => {
      await usePreferencesStore.getState().loadFromStorage();
    });

    expect(usePreferencesStore.getState().lastPaymentMethods).toEqual({});
    expect(usePreferencesStore.getState().isHydrated).toBe(true);
  });

  it('clearLastPaymentMethods wipes memory and storage (account-scope reset)', async () => {
    act(() =>
      usePreferencesStore
        .getState()
        .setLastPaymentMethod('user-1', { id: '__gcash__', type: 'gcash' }),
    );

    act(() => usePreferencesStore.getState().clearLastPaymentMethods());

    expect(usePreferencesStore.getState().lastPaymentMethods).toEqual({});
    expect(await AsyncStorage.getItem(PAYMENT_MEMORY_KEY)).toBeNull();
  });

  it('loadFromStorage is a no-op once hydrated', async () => {
    usePreferencesStore.setState({ isHydrated: true });
    await AsyncStorage.setItem(
      PAYMENT_MEMORY_KEY,
      JSON.stringify({ 'user-1': { id: '__card__', type: 'card', savedAt: 1 } }),
    );

    await act(async () => {
      await usePreferencesStore.getState().loadFromStorage();
    });

    expect(usePreferencesStore.getState().lastPaymentMethods).toEqual({});
  });
});
