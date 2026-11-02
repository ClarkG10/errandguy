import { renderHook } from '@testing-library/react-native';
import {
  bookingPaymentFailure,
  CHECKOUT_CANCELLED,
  CHECKOUT_CANCELLED_MESSAGE,
} from '../useCompleteBookingPayment';
import { usePaymentVerification } from '../usePaymentVerification';
import { usePaymentStore } from '../../stores/paymentStore';
import { paymentService } from '../../services/payment.service';

jest.mock('../../services/payment.service', () => ({
  paymentService: {
    getPaymentStatus: jest.fn(),
    getBookingPaymentStatus: jest.fn(),
    getTransactionStatus: jest.fn(),
  },
}));

// Capture the verifier's tick so the test can run one poll by hand.
let mockTick: (() => Promise<void>) | null = null;
jest.mock('../useSmartPolling', () => ({
  useSmartPolling: (fn: () => Promise<void>) => {
    mockTick = fn;
  },
}));

/**
 * The failure card for a booking's GCash/Maya charge, and the ONE next step it
 * offers. "Try again" reopens the same one-time charge, so it is only honest
 * while that charge is still open; once the server has ruled on it the errand
 * is cancelled and the way forward is a new booking.
 */
describe('bookingPaymentFailure', () => {
  it('a checkout the customer closed is resumed — the charge is still open', () => {
    expect(bookingPaymentFailure(CHECKOUT_CANCELLED)).toEqual({
      title: 'Payment not finished',
      message: CHECKOUT_CANCELLED_MESSAGE,
      recovery: 'resume',
    });
  });

  it('a checkout that never opened can be tried again — nothing was attempted', () => {
    const f = bookingPaymentFailure(undefined);
    expect(f.recovery).toBe('retry');
    expect(f.message).toMatch(/weren't charged/);
  });

  it('a refunded payment says it went back to the wallet, and never "you weren\'t charged"', () => {
    const f = bookingPaymentFailure('refunded');
    expect(f.title).toBe('Payment refunded');
    expect(f.message).toBe(
      'Your payment went through after the errand was cancelled, so it was returned to your ErrandGuy wallet.',
    );
    expect(f.message).not.toMatch(/weren't charged/);
    expect(f.recovery).not.toBe('retry');
    expect(f.recovery).not.toBe('resume');
  });

  it.each([
    ['DECLINED_BY_PROVIDER', 'Payment declined'],
    ['expired', 'Payment expired'],
    ['INSUFFICIENT_BALANCE', 'Insufficient funds'],
    ['cancelled', 'Payment cancelled'],
    ['failed', 'Payment declined'],
    ['SOME_NEW_GATEWAY_CODE', "Payment didn't go through"],
  ])('a %s charge cancelled the errand: Book again, never Try again', (reason, title) => {
    const f = bookingPaymentFailure(reason);
    expect(f.title).toBe(title);
    expect(f.recovery).toBe('rebook');
    expect(f.message).toMatch(/cancelled/);
    expect(f.message).toMatch(/book it again/i);
    expect(f.message).not.toMatch(/try again/i);
  });
});

describe('usePaymentVerification — a refunded verdict', () => {
  beforeEach(() => {
    mockTick = null;
    usePaymentStore.setState({ attempt: null, isHydrated: true });
  });

  it.each([
    ['an older server, whose reason is the gateway status', 'SUCCEEDED'],
    ['a tip refunded for an errand already tipped', 'This errand was already tipped.'],
    ['the new contract', 'refunded'],
  ])('is filed as "refunded" whatever the reason text (%s)', async (_label, failure_reason) => {
    usePaymentStore.getState().beginAttempt({ kind: 'booking', amount: 92, bookingId: 'bk-1' });
    usePaymentStore.getState().setStatus('verifying', { bookingId: 'bk-1' });
    (paymentService.getBookingPaymentStatus as jest.Mock).mockResolvedValue({
      data: { data: { status: 'refunded', failure_reason } },
    });

    renderHook(() => usePaymentVerification());
    await mockTick!();

    expect(usePaymentStore.getState().attempt).toMatchObject({
      status: 'failed',
      failureReason: 'refunded',
    });
  });

  it('keeps the gateway’s own reason for an ordinary failure', async () => {
    usePaymentStore.getState().beginAttempt({ kind: 'booking', amount: 92, bookingId: 'bk-1' });
    usePaymentStore.getState().setStatus('verifying', { bookingId: 'bk-1' });
    (paymentService.getBookingPaymentStatus as jest.Mock).mockResolvedValue({
      data: { data: { status: 'failed', failure_reason: 'DECLINED_BY_PROVIDER' } },
    });

    renderHook(() => usePaymentVerification());
    await mockTick!();

    expect(usePaymentStore.getState().attempt?.failureReason).toBe('DECLINED_BY_PROVIDER');
  });
});
