import {
  DEFAULT_OFFER_TIMEOUT_SECONDS,
  MAX_OFFER_TIMEOUT_SECONDS,
  MIN_OFFER_TIMEOUT_SECONDS,
  extraStopCount,
  offerExpiresAt,
  offerTimeoutSeconds,
  paymentMethodLabel,
  readAcceptDeadline,
  readAmountToCollect,
  readPaymentMethodType,
  readServerPickupKm,
  scheduledOfferLabel,
} from '../offerMeta';
import { makeBooking } from '../../../__mocks__/factories';
import type { Booking } from '../../../types';

/** Booking + the runner-gated fields BookingResource only sends to runners. */
const withOps = (extra: Record<string, unknown>): Booking =>
  ({ ...makeBooking(), ...extra }) as Booking;

describe('offerTimeoutSeconds', () => {
  const now = Date.parse('2026-08-28T10:00:00.000Z');

  it('falls back to the 30s default when there is no deadline', () => {
    expect(offerTimeoutSeconds(null, { now })).toBe(DEFAULT_OFFER_TIMEOUT_SECONDS);
    expect(offerTimeoutSeconds(undefined, { now })).toBe(DEFAULT_OFFER_TIMEOUT_SECONDS);
    expect(offerTimeoutSeconds('', { now })).toBe(DEFAULT_OFFER_TIMEOUT_SECONDS);
  });

  it('falls back when the deadline is unparseable', () => {
    expect(offerTimeoutSeconds('not-a-date', { now })).toBe(
      DEFAULT_OFFER_TIMEOUT_SECONDS,
    );
  });

  it("uses the server's real window instead of the 30s guess", () => {
    // The server honours matched_acceptance_timeout_seconds (default 90s).
    expect(offerTimeoutSeconds('2026-08-28T10:01:30.000Z', { now })).toBe(90);
  });

  it('clamps a runaway deadline to the ceiling', () => {
    expect(offerTimeoutSeconds('2026-08-29T10:00:00.000Z', { now })).toBe(
      MAX_OFFER_TIMEOUT_SECONDS,
    );
  });

  it('clamps an already-passed deadline to the floor rather than 0', () => {
    expect(offerTimeoutSeconds('2026-08-28T09:59:00.000Z', { now })).toBe(
      MIN_OFFER_TIMEOUT_SECONDS,
    );
  });

  it('honours an explicit fallback', () => {
    expect(offerTimeoutSeconds(null, { now, fallback: 45 })).toBe(45);
  });
});

describe('offerExpiresAt', () => {
  it('is now + the resolved window', () => {
    const now = Date.parse('2026-08-28T10:00:00.000Z');
    expect(offerExpiresAt('2026-08-28T10:01:30.000Z', { now })).toBe(now + 90_000);
    expect(offerExpiresAt(null, { now })).toBe(
      now + DEFAULT_OFFER_TIMEOUT_SECONDS * 1000,
    );
  });
});

describe('runner-gated field readers', () => {
  it('reads amount_to_collect only when it is a positive number', () => {
    expect(readAmountToCollect(withOps({ amount_to_collect: 1240 }))).toBe(1240);
    expect(readAmountToCollect(withOps({ amount_to_collect: '1240.50' }))).toBe(1240.5);
    expect(readAmountToCollect(withOps({ amount_to_collect: 0 }))).toBeNull();
    expect(readAmountToCollect(withOps({ amount_to_collect: null }))).toBeNull();
    expect(readAmountToCollect(withOps({}))).toBeNull();
  });

  it('prefers payment_method_type but falls back to the plain column', () => {
    expect(readPaymentMethodType(withOps({ payment_method_type: 'gcash' }))).toBe('gcash');
    expect(
      readPaymentMethodType(withOps({ payment_method_type: null, payment_method: 'cash' })),
    ).toBe('cash');
    expect(
      readPaymentMethodType(withOps({ payment_method_type: null, payment_method: null })),
    ).toBeNull();
  });

  it('reads the server pickup distance defensively', () => {
    expect(readServerPickupKm(withOps({ distance_to_pickup_km: 1.2 }))).toBe(1.2);
    expect(readServerPickupKm(withOps({ distance_to_pickup_km: '2.5' }))).toBe(2.5);
    expect(readServerPickupKm(withOps({ distance_to_pickup_km: 0 }))).toBeNull();
    expect(readServerPickupKm(withOps({}))).toBeNull();
  });

  it('reads accept_deadline only when it is a non-empty string', () => {
    expect(readAcceptDeadline(withOps({ accept_deadline: '2026-08-28T10:01:30Z' }))).toBe(
      '2026-08-28T10:01:30Z',
    );
    expect(readAcceptDeadline(withOps({ accept_deadline: '' }))).toBeNull();
    expect(readAcceptDeadline(withOps({}))).toBeNull();
  });
});

describe('paymentMethodLabel', () => {
  it('maps the known gateway keys', () => {
    expect(paymentMethodLabel('cash')).toBe('Cash');
    expect(paymentMethodLabel('gcash')).toBe('GCash');
    expect(paymentMethodLabel('maya')).toBe('Maya');
    expect(paymentMethodLabel('card')).toBe('Card');
    expect(paymentMethodLabel('wallet')).toBe('Wallet');
  });

  it('title-cases an unknown method rather than hiding it', () => {
    expect(paymentMethodLabel('bank_transfer')).toBe('Bank transfer');
  });

  it('is null for an unknown/absent method', () => {
    expect(paymentMethodLabel(null)).toBeNull();
    expect(paymentMethodLabel(undefined)).toBeNull();
  });
});

describe('scheduledOfferLabel', () => {
  it('is null for immediate bookings', () => {
    expect(
      scheduledOfferLabel(withOps({ schedule_type: 'now', scheduled_at: null })),
    ).toBeNull();
  });

  it('names the day and time for a scheduled window', () => {
    const at = new Date();
    at.setHours(15, 0, 0, 0);
    const label = scheduledOfferLabel(
      withOps({ schedule_type: 'scheduled', scheduled_at: at.toISOString() }),
    );
    expect(label).toBe('Scheduled · today 3:00 PM');
  });

  it('is null when scheduled_at is missing', () => {
    expect(
      scheduledOfferLabel(withOps({ schedule_type: 'scheduled', scheduled_at: null })),
    ).toBeNull();
  });
});

describe('extraStopCount', () => {
  it('counts loaded stops and tolerates the relation being absent', () => {
    expect(extraStopCount(withOps({}))).toBe(0);
    expect(extraStopCount(withOps({ stops: [] }))).toBe(0);
    expect(
      extraStopCount(
        withOps({ stops: [{ id: 'a', sequence: 1, address: 'x', lat: 0, lng: 0 }] }),
      ),
    ).toBe(1);
  });
});
