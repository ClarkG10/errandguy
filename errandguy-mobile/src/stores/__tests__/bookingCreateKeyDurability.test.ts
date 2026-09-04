import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBookingStore } from '../bookingStore';

/**
 * The booking-create idempotency key has to outlive the process.
 *
 * "Confirm & pay" is a multi-second round trip behind a full-screen overlay. If
 * the customer takes a call or force-quits — after the server has persisted the
 * booking but before the response is handled — the DRAFT survives (it is
 * persisted) while the key did not (it lived in a component ref). On relaunch
 * they got a "Continue your errand" resume card, and confirming it minted a
 * FRESH key, so the server treated it as a brand-new request: a second errand,
 * a second Xendit invoice, two runners dispatched to one pickup, and a
 * cancellation fee on whichever one they killed.
 *
 * The key now rides in the same envelope as the draft. These pin the two
 * properties that make that safe: it survives a relaunch, and it is NOT reused
 * where reuse would be wrong.
 */
const KEY = '@booking_draft_v1';

/** Force a fresh hydration, as a relaunch would. */
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

describe('create-key durability', () => {
  it('survives a relaunch alongside the draft it belongs to', async () => {
    useBookingStore.getState().updateDraft({ pickup_address: 'A' });
    useBookingStore.getState().setStep(4);
    useBookingStore.getState().setCreateKey('key-abc', 'sig-1');

    await relaunch();

    const s = useBookingStore.getState();
    expect(s.createKey).toBe('key-abc');
    expect(s.createKeySig).toBe('sig-1');
    // …and the draft it belongs to came back with it.
    expect(s.draftBooking.pickup_address).toBe('A');
    expect(s.currentStep).toBe(4);
  });

  it('is written immediately, not on the persist debounce', async () => {
    // The kill this protects against can land inside a 250ms debounce window —
    // precisely while the customer is staring at the overlay wondering if it
    // has hung. So the key must already be on disk.
    useBookingStore.getState().updateDraft({ pickup_address: 'A' });
    useBookingStore.getState().setCreateKey('key-now', 'sig-now');

    const raw = await AsyncStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).createKey).toBe('key-now');
  });

  it('dies with the draft, so a NEW booking never replays it', async () => {
    useBookingStore.getState().updateDraft({ pickup_address: 'A' });
    useBookingStore.getState().setCreateKey('key-spent', 'sig-1');

    useBookingStore.getState().clearDraft();

    expect(useBookingStore.getState().createKey).toBeNull();
    await relaunch();
    // Replaying a spent key would make idempotency return the PREVIOUS booking
    // instead of creating the new one.
    expect(useBookingStore.getState().createKey).toBeNull();
  });

  it('is cleared explicitly once the server has answered', async () => {
    useBookingStore.getState().updateDraft({ pickup_address: 'A' });
    useBookingStore.getState().setCreateKey('key-1', 'sig-1');

    useBookingStore.getState().setCreateKey(null, null);

    await relaunch();
    expect(useBookingStore.getState().createKey).toBeNull();
    // The draft itself is untouched by clearing the key.
    expect(useBookingStore.getState().draftBooking.pickup_address).toBe('A');
  });

  it('does not resurrect a key from a stale draft', async () => {
    useBookingStore.getState().updateDraft({ pickup_address: 'A' });
    useBookingStore.getState().setCreateKey('key-old', 'sig-1');

    // Age the envelope past the 24h staleness cutoff.
    const raw = JSON.parse((await AsyncStorage.getItem(KEY)) as string);
    raw.savedAt = Date.now() - 48 * 60 * 60 * 1000;
    await AsyncStorage.setItem(KEY, JSON.stringify(raw));

    await relaunch();

    // A day-old draft is dropped wholesale; its key must go with it rather than
    // charge against a booking the customer has long forgotten.
    expect(useBookingStore.getState().createKey).toBeNull();
    expect(useBookingStore.getState().draftBooking).toEqual({});
  });

  it('tolerates an envelope written before the key existed', async () => {
    // Older builds persisted no createKey; hydration must not throw or invent one.
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ draft: { pickup_address: 'A' }, step: 2, savedAt: Date.now() }),
    );

    await relaunch();

    expect(useBookingStore.getState().draftBooking.pickup_address).toBe('A');
    expect(useBookingStore.getState().createKey).toBeNull();
  });
});

describe('the review screen uses the persisted key', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', 'app', '(customer)', 'book', 'review.tsx'),
    'utf8',
  );

  it('no longer holds the key in a component ref', () => {
    // The ref is exactly what died with the process.
    expect(source).not.toContain('createKeyRef');
    expect(source).not.toContain('createKeySigRef');
  });

  it('mints only when there is no key or the payload changed', () => {
    // The signature check is load-bearing: the server hashes the whole body, so
    // an EDITED draft must get a fresh key, while an untouched resumed draft
    // replays the same one and gets the original booking back.
    expect(source).toMatch(/if \(!createKey \|\| persisted\.createKeySig !== payloadSignature\)/);
    expect(source).toContain('setCreateKey(createKey, payloadSignature)');
  });

  it('still clears the key on success and on a definitive 4xx only', () => {
    expect(source).toContain('setCreateKey(null, null)');
    expect(source).toMatch(/if \(!shouldRetainIdempotencyKey\(err\)\)/);
  });
});
