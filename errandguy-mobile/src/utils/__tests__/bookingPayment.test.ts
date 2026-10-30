import {
  UNPAID_CHECKOUT_WINDOW_MINUTES,
  bookingCheckoutUrl,
  isAwaitingPayment,
  paymentDeadline,
  paymentDeadlineLine,
  unpaidCancelMessage,
  wasCancelledForUnpaidPayment,
} from '../bookingPayment';
import type { BookingStatus } from '../../types';

/**
 * The GCash / Maya waiting room. A booking paid online is held back from every
 * runner until its payment is confirmed, so the app must say "Waiting for your
 * payment" — never "Finding a runner" — and must recognise the server's
 * cancellation of a booking that was never paid.
 */
const b = (
  status: BookingStatus,
  extra: Partial<{
    awaiting_payment: boolean;
    checkout_url: string | null;
    created_at: string;
    cancellation_reason: string | null;
    cancellation_code: string | null;
  }> = {},
) => ({ status, ...extra });

describe('isAwaitingPayment', () => {
  it('is true only for a pending booking the server flags as awaiting payment', () => {
    expect(isAwaitingPayment(b('pending', { awaiting_payment: true }))).toBe(true);
    expect(isAwaitingPayment(b('pending', { awaiting_payment: false }))).toBe(false);
  });

  it('reads an older server (no field) as not waiting — the old behaviour', () => {
    expect(isAwaitingPayment(b('pending'))).toBe(false);
    expect(isAwaitingPayment(null)).toBe(false);
    expect(isAwaitingPayment(undefined)).toBe(false);
  });

  it('never applies past pending, whatever the flag says', () => {
    expect(isAwaitingPayment(b('matched', { awaiting_payment: true }))).toBe(false);
    expect(isAwaitingPayment(b('cancelled', { awaiting_payment: true }))).toBe(false);
  });
});

describe('bookingCheckoutUrl', () => {
  it("returns the booking's own checkout while it waits for payment", () => {
    expect(
      bookingCheckoutUrl(
        b('pending', { awaiting_payment: true, checkout_url: 'https://pay.example/abc' }),
      ),
    ).toBe('https://pay.example/abc');
  });

  it('offers nothing once paid, or when the server sent no link', () => {
    expect(
      bookingCheckoutUrl(
        b('pending', { awaiting_payment: false, checkout_url: 'https://pay.example/abc' }),
      ),
    ).toBeNull();
    expect(bookingCheckoutUrl(b('pending', { awaiting_payment: true }))).toBeNull();
    expect(
      bookingCheckoutUrl(b('pending', { awaiting_payment: true, checkout_url: '' })),
    ).toBeNull();
  });
});

describe('the payment deadline', () => {
  const created = '2026-10-31T06:00:00.000Z';

  it(`is ${UNPAID_CHECKOUT_WINDOW_MINUTES} minutes after creation`, () => {
    expect(paymentDeadline(b('pending', { created_at: created }))).toBe(
      Date.parse(created) + 15 * 60_000,
    );
    expect(paymentDeadline(b('pending'))).toBeNull();
  });

  it('names the clock time while there is still time to pay', () => {
    const line = paymentDeadlineLine(
      b('pending', { created_at: created }),
      () => '2:15 PM',
      Date.parse(created) + 60_000,
    );
    expect(line).toBe('Pay by 2:15 PM, or this errand is cancelled.');
  });

  it('falls back to the rule when the time is unknown or already past', () => {
    expect(paymentDeadlineLine(b('pending'), () => 'x')).toBe(
      'An errand left unpaid for 15 minutes is cancelled.',
    );
    expect(
      paymentDeadlineLine(
        b('pending', { created_at: created }),
        () => 'x',
        Date.parse(created) + 16 * 60_000,
      ),
    ).toBe('An errand left unpaid for 15 minutes is cancelled.');
  });
});

describe('wasCancelledForUnpaidPayment', () => {
  it.each([
    // The 15-minute sweep and the decline/expiry teardown.
    "Payment wasn't completed, so your errand was cancelled.",
    'Payment wasn’t completed, so your errand was cancelled.',
    // Reasons recorded by the server before this change.
    'Online payment was not completed',
    'Checkout window expired before payment was completed',
  ])('recognises "%s"', (reason) => {
    expect(wasCancelledForUnpaidPayment(b('cancelled', { cancellation_reason: reason }))).toBe(
      true,
    );
  });

  it.each([
    'Customer cancelled',
    'No runner accepted in time',
    'Runner could not complete the errand',
    '',
  ])('leaves any other cancellation alone: "%s"', (reason) => {
    expect(wasCancelledForUnpaidPayment(b('cancelled', { cancellation_reason: reason }))).toBe(
      false,
    );
  });

  it('trusts the structured code over the wording when the server sends it', () => {
    expect(
      wasCancelledForUnpaidPayment(
        b('cancelled', { cancellation_code: 'payment_not_completed', cancellation_reason: 'reworded' }),
      ),
    ).toBe(true);
    // A code that says otherwise wins even if the text looks like a payment cancel.
    expect(
      wasCancelledForUnpaidPayment(
        b('cancelled', {
          cancellation_code: null,
          cancellation_reason: "Payment wasn't completed, so your errand was cancelled.",
        }),
      ),
    ).toBe(false);
  });

  it('only ever applies to a cancelled booking', () => {
    expect(
      wasCancelledForUnpaidPayment(
        b('pending', { cancellation_reason: 'Online payment was not completed' }),
      ),
    ).toBe(false);
    expect(wasCancelledForUnpaidPayment(b('cancelled'))).toBe(false);
  });
});

describe('unpaidCancelMessage', () => {
  it('says plainly that nothing was charged and no runner was sent', () => {
    expect(unpaidCancelMessage({ runner_id: null })).toBe(
      "Your payment wasn't completed, so this errand was cancelled before any runner was sent. You weren't charged.",
    );
  });

  it('does not claim no runner was involved when one was (an older booking)', () => {
    expect(unpaidCancelMessage({ runner_id: 'runner-1' })).not.toMatch(/runner was sent/);
  });
});
