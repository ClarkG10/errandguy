/**
 * Maps a backend/gateway failure reason to honest, actionable copy for the
 * payment failure UI. Never blames the user vaguely; always says whether they
 * were charged and what to do next. Defaults are safe ("you weren't charged").
 */
export interface PaymentErrorInfo {
  title: string;
  message: string;
  retryable: boolean;
}

/**
 * The client's own reason for a checkout that closed (or that a relaunch found
 * still open) before any payment was seen. NOT a server verdict: the customer
 * may have paid and the confirmation not landed yet, so it must never read as
 * "cancelled — you weren't charged". The attempt stays verified while it is on
 * screen (usePaymentVerification), and flips the moment the server rules.
 */
export const CHECKOUT_CANCELLED = 'checkout_cancelled';

const NOT_RECEIVED_YET: PaymentErrorInfo = {
  title: 'Payment not received yet',
  message: "We haven't received this payment yet. If you already paid, this updates by itself.",
  retryable: true,
};

const DEFAULT: PaymentErrorInfo = {
  title: "Payment didn't go through",
  message:
    "We couldn't confirm this payment. You weren't charged — try again or pick another method.",
  retryable: true,
};

export function mapFailureReason(reason?: string | null): PaymentErrorInfo {
  const r = (reason ?? '').toString().toLowerCase();
  if (!r) return DEFAULT;

  // Before the generic "cancel" match below, which says "you weren't charged"
  // — something only the server can know.
  if (r === CHECKOUT_CANCELLED) return NOT_RECEIVED_YET;

  // The charge went through and was then given back — e.g. a second GCash/Maya
  // tip for an errand that was already tipped. "You weren't charged" would be
  // untrue; the money is in the wallet.
  if (r.includes('refund')) {
    return {
      title: 'Payment refunded',
      message: 'This payment was refunded to your ErrandGuy wallet.',
      retryable: false,
    };
  }

  if (r.includes('insufficient') || r.includes('balance')) {
    return {
      title: 'Insufficient funds',
      message:
        "There wasn't enough balance to cover this payment. Choose another payment method.",
      retryable: true,
    };
  }
  if (r.includes('expired')) {
    return {
      title: 'Payment expired',
      message:
        "The payment window expired before it completed. You weren't charged — you can try again.",
      retryable: true,
    };
  }
  if (r.includes('declin') || r.includes('rejected') || r.includes('failed')) {
    return {
      title: 'Payment declined',
      message:
        'Your bank or provider declined this payment. Try another method, or contact your bank.',
      retryable: true,
    };
  }
  if (r.includes('cancel')) {
    return {
      title: 'Payment cancelled',
      message: "This payment was cancelled. You weren't charged — try again when you're ready.",
      retryable: true,
    };
  }
  if (r.includes('auth') || r.includes('otp') || r.includes('action')) {
    return {
      title: 'Verification needed',
      message:
        'Your bank needs to verify this payment. Try again and complete the verification step.',
      retryable: true,
    };
  }
  return DEFAULT;
}
