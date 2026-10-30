import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBookingStore } from '../bookingStore';

/**
 * Promo codes are retired, but a phone that updates over the air can still
 * hold a half-finished booking draft saved by the build that had them — with a
 * `promo_code` and its saved peso `promo_discount` inside. That draft is still
 * the customer's work, so it must come back intact, minus those two fields:
 * nothing reads them now, and leaving them in would re-persist them on every
 * edit for anything that spreads the draft into a request to re-send.
 */
const KEY = '@booking_draft_v1';

const relaunch = async () => {
  useBookingStore.setState({
    draftBooking: {},
    currentStep: 0,
    isDraftHydrated: false,
    createKey: null,
    createKeySig: null,
  });
  await useBookingStore.getState().loadDraftFromStorage();
};

const saveLegacyEnvelope = (draft: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  AsyncStorage.setItem(KEY, JSON.stringify({ draft, step: 3, savedAt: Date.now(), ...extra }));

beforeEach(async () => {
  await AsyncStorage.clear();
  useBookingStore.setState({
    draftBooking: {},
    currentStep: 0,
    isDraftHydrated: false,
    createKey: null,
    createKeySig: null,
  });
});

describe('a booking draft saved by the promo-code build', () => {
  it('restores everything except the promo fields', async () => {
    await saveLegacyEnvelope(
      {
        errand_type_id: 'type-1',
        pickup_address: 'A',
        pickup_lat: 14.6,
        pickup_lng: 121.0,
        payment_method_id: '__gcash__',
        promo_code: 'SAVE10',
        promo_discount: 25,
      },
      { createKey: 'key-1', createKeySig: 'sig-1' },
    );

    await relaunch();

    const s = useBookingStore.getState();
    expect(s.isDraftHydrated).toBe(true);
    expect(s.draftBooking).toEqual({
      errand_type_id: 'type-1',
      pickup_address: 'A',
      pickup_lat: 14.6,
      pickup_lng: 121.0,
      payment_method_id: '__gcash__',
    });
    expect(s.currentStep).toBe(3);
    // The create key is untouched: idempotency still compares the payload
    // signature, so it simply stops matching the promo-free body.
    expect(s.createKey).toBe('key-1');
    expect(s.createKeySig).toBe('sig-1');
  });

  it('does not write the promo fields back on the next edit', async () => {
    await saveLegacyEnvelope({ pickup_address: 'A', promo_code: 'SAVE10', promo_discount: 25 });
    await relaunch();

    useBookingStore.getState().updateDraft({ special_instructions: 'Gate 2' });
    // Past the 250ms persist debounce.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const stored = JSON.parse((await AsyncStorage.getItem(KEY)) as string);
    expect(stored.draft).toEqual({ pickup_address: 'A', special_instructions: 'Gate 2' });
  });

  it('comes back empty when a promo code was all it held', async () => {
    // The old Promos screen's "Use offer" seeded a draft with nothing but the
    // code before the customer picked an errand type.
    await saveLegacyEnvelope({ promo_code: 'SAVE10' }, { step: 0 });

    await relaunch();

    expect(useBookingStore.getState().draftBooking).toEqual({});
  });
});
