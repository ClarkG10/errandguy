import { renderHook } from '@testing-library/react-native';
import {
  bookingPaymentFailure,
  CHECKOUT_CANCELLED,
  CHECKOUT_CANCELLED_MESSAGE,
  settleClosedCheckout,
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

// Capture the verifier's tick (and how it asked to be polled) so the test can
// run one poll by hand.
let mockTick: (() => Promise<void>) | null = null;
let mockPollOptions: { interval: number; enabled?: boolean } | null = null;
jest.mock('../useSmartPolling', () => ({
  useSmartPolling: (fn: () => Promise<void>, options: { interval: number; enabled?: boolean }) => {
    mockTick = fn;
    mockPollOptions = options;
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
      title: 'Payment not received yet',
      message: CHECKOUT_CANCELLED_MESSAGE,
      recovery: 'resume',
    });
  });

  it('a closed checkout never claims for certain that nothing was charged', () => {
    // Closing the sheet can come AFTER paying (iOS reports a cancel when it is
    // dismissed before the redirect), so the card says only what we know.
    expect(CHECKOUT_CANCELLED_MESSAGE).toMatch(/^We haven't received your payment yet/);
    expect(CHECKOUT_CANCELLED_MESSAGE).not.toMatch(/nothing was charged|weren't charged/i);
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

/**
 * Closing the GCash/Maya sheet used to land on "nothing was charged" at once.
 * Now it asks the server ONCE, briefly, and only then decides.
 */
describe('settleClosedCheckout — one quick check after the sheet is closed', () => {
  const startBookingAttempt = () => {
    usePaymentStore.getState().beginAttempt({ kind: 'booking', amount: 150, bookingId: 'bk-1' });
    usePaymentStore.getState().setStatus('awaiting_gateway', {
      bookingId: 'bk-1',
      checkoutUrl: 'https://checkout.example/abc',
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    usePaymentStore.setState({ attempt: null, isHydrated: true });
  });

  it('paid after all → the success path', async () => {
    startBookingAttempt();
    (paymentService.getBookingPaymentStatus as jest.Mock).mockResolvedValue({
      data: { data: { status: 'completed', reference: 'EG-1', method: 'gcash', amount: 150 } },
    });

    await settleClosedCheckout();

    expect(paymentService.getBookingPaymentStatus).toHaveBeenCalledTimes(1);
    expect(usePaymentStore.getState().attempt).toMatchObject({ status: 'success', reference: 'EG-1' });
  });

  it('still open → the resumable "not received yet" card', async () => {
    startBookingAttempt();
    (paymentService.getBookingPaymentStatus as jest.Mock).mockResolvedValue({
      data: { data: { status: 'pending' } },
    });

    await settleClosedCheckout();

    expect(usePaymentStore.getState().attempt).toMatchObject({
      status: 'failed',
      failureReason: CHECKOUT_CANCELLED,
      checkoutUrl: 'https://checkout.example/abc',
    });
  });

  it('a failed read is never a verdict — it lands on the same resumable card', async () => {
    startBookingAttempt();
    (paymentService.getBookingPaymentStatus as jest.Mock).mockRejectedValue({ status: 0 });

    await settleClosedCheckout();

    expect(usePaymentStore.getState().attempt).toMatchObject({
      status: 'failed',
      failureReason: CHECKOUT_CANCELLED,
    });
  });

  it('does not wait on a slow read — it gives up after a few seconds', async () => {
    jest.useFakeTimers();
    try {
      startBookingAttempt();
      (paymentService.getBookingPaymentStatus as jest.Mock).mockReturnValue(new Promise(() => {}));

      const done = settleClosedCheckout();
      // While it checks, the overlay says so honestly ("verifying").
      expect(usePaymentStore.getState().attempt?.status).toBe('verifying');
      await jest.advanceTimersByTimeAsync(4000);
      await done;

      expect(usePaymentStore.getState().attempt).toMatchObject({
        status: 'failed',
        failureReason: CHECKOUT_CANCELLED,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('a charge the server already ruled on keeps that verdict', async () => {
    startBookingAttempt();
    (paymentService.getBookingPaymentStatus as jest.Mock).mockResolvedValue({
      data: { data: { status: 'expired' } },
    });

    await settleClosedCheckout();

    expect(usePaymentStore.getState().attempt).toMatchObject({ status: 'failed', failureReason: 'expired' });
    expect(bookingPaymentFailure('expired').recovery).toBe('rebook');
  });

  it('a payment the poll already confirmed is never walked back to "not received yet"', async () => {
    // Paid in GCash, back in the app: the poll (running while the sheet was
    // open) has already said "confirmed" when the sheet reports its close.
    startBookingAttempt();
    usePaymentStore.getState().setStatus('success', { reference: 'EG-1' });

    await settleClosedCheckout();

    expect(paymentService.getBookingPaymentStatus).not.toHaveBeenCalled();
    expect(usePaymentStore.getState().attempt).toMatchObject({ status: 'success', reference: 'EG-1' });
  });
});

/**
 * "Not received yet" used to be the end of it: the attempt was marked failed,
 * polling stopped, and the card's "If you already paid, this updates by itself"
 * never came true. On Android, coming back from the GCash app counts as a
 * close, so a customer who paid could be left on "not received" for good.
 */
describe('a checkout that closed with no payment seen yet', () => {
  const closedUnpaid = async () => {
    usePaymentStore.getState().beginAttempt({ kind: 'booking', amount: 150, bookingId: 'bk-1' });
    usePaymentStore.getState().setStatus('awaiting_gateway', {
      bookingId: 'bk-1',
      checkoutUrl: 'https://checkout.example/abc',
    });
    (paymentService.getBookingPaymentStatus as jest.Mock).mockResolvedValueOnce({
      data: { data: { status: 'pending' } },
    });
    await settleClosedCheckout();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockTick = null;
    mockPollOptions = null;
    usePaymentStore.setState({ attempt: null, isHydrated: true });
  });

  it('keeps being checked, at a slow cadence', async () => {
    await closedUnpaid();
    renderHook(() => usePaymentVerification());

    expect(mockPollOptions?.enabled).toBe(true);
    expect(mockPollOptions?.interval).toBe(10000);
  });

  it('turns into the receipt when the payment lands after all', async () => {
    await closedUnpaid();
    renderHook(() => usePaymentVerification());
    (paymentService.getBookingPaymentStatus as jest.Mock).mockResolvedValue({
      data: { data: { status: 'completed', reference: 'EG-1', method: 'gcash', amount: 150 } },
    });

    await mockTick!();

    expect(usePaymentStore.getState().attempt).toMatchObject({ status: 'success', reference: 'EG-1' });
  });

  it('stays "not received yet" while the server still has no payment', async () => {
    await closedUnpaid();
    renderHook(() => usePaymentVerification());
    (paymentService.getBookingPaymentStatus as jest.Mock).mockResolvedValue({
      data: { data: { status: 'pending' } },
    });

    await mockTick!();

    expect(usePaymentStore.getState().attempt).toMatchObject({
      status: 'failed',
      failureReason: CHECKOUT_CANCELLED,
    });
  });

  it("stops once the server rules on it, and takes the server's verdict", async () => {
    await closedUnpaid();
    renderHook(() => usePaymentVerification());
    (paymentService.getBookingPaymentStatus as jest.Mock).mockResolvedValue({
      data: { data: { status: 'expired' } },
    });

    await mockTick!();
    expect(usePaymentStore.getState().attempt).toMatchObject({ status: 'failed', failureReason: 'expired' });

    renderHook(() => usePaymentVerification());
    expect(mockPollOptions?.enabled).toBe(false);
  });

  it('an ordinary server failure is not polled — it is final', () => {
    usePaymentStore.getState().beginAttempt({ kind: 'booking', amount: 150, bookingId: 'bk-1' });
    usePaymentStore.getState().setStatus('failed', { failureReason: 'DECLINED_BY_PROVIDER' });

    renderHook(() => usePaymentVerification());

    expect(mockPollOptions?.enabled).toBe(false);
  });
});
