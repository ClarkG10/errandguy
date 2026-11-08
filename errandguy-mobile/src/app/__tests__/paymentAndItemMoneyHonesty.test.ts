import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Two money promises the app used to make and the product never kept.
 *
 *  1. Paying "later, from the errand". A GCash/Maya customer who backed out
 *     of checkout was told they could do that — there was no such button,
 *     and the errand went to runners unpaid anyway. Now the
 *     server holds an unpaid booking back from runners, and both the waiting
 *     screen and the tracking screen carry a real "Complete payment".
 *
 *  2. Item money on shopping errands. The runner pays for the items and the
 *     customer repays them IN CASH at the door; nothing for items is charged
 *     online. Yet the customer was shown a pre-approved budget with a wallet
 *     refund of the unspent part, and the runner was told the customer is
 *     charged for the items. Every surface now says cash at the door, up to
 *     the budget.
 *
 * The tracking screen and the runner cockpit can't be rendered under jest
 * (map, router, sockets, every store), so their wiring is pinned against the
 * source, the same way trackingTerminalReceipt.test.ts does.
 */
const SRC = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');

const TRACKING = read('app', '(customer)', 'tracking', '[id].tsx');
const REVIEW = read('app', '(customer)', 'book', 'review.tsx');
const DETAILS = read('app', '(customer)', 'book', 'details.tsx');
const COCKPIT = read('app', '(runner)', 'errand', '[id].tsx');
const RECEIPT_MODAL = read('components', 'runner', 'ReceiptCaptureModal.tsx');

/** Every non-test source file under src/. */
function sourceFiles(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === '__mocks__') continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push({ path: full.slice(SRC.length + 1), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(SRC);
  return out;
}

describe('no false money promises anywhere in the app', () => {
  const files = sourceFiles();

  // Patterns spelled with \s+ so this file never matches a plain grep for
  // the phrases it bans.
  it.each([
    ['pay … later', /pay\s+later/i],
    ['pre-approved budget wording (either spelling)', /pre-?\s*authori[sz]/i],
    ['refund … to wallet', /refund\s+to\s+wallet/i],
    ['charged … the actual cost', /charged\s+the\s+actual/i],
    ['charged … to the customer', /charged\s+to\s+the\s+customer/i],
  ])('never says "%s"', (_label, pattern) => {
    const offenders = files.filter((f) => pattern.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe('a GCash/Maya booking waiting for its payment', () => {
  it('the review screen points at the real way back, Complete payment', () => {
    // Its failure card reads the ONE booking-payment mapping (which carries
    // CHECKOUT_CANCELLED_MESSAGE) — the same one the waiting screen and
    // tracking use through useCompleteBookingPayment.
    expect(REVIEW).toMatch(
      /import \{\s*bookingPaymentFailure,\s*settleClosedCheckout,\s*\} from '..\/..\/..\/hooks\/useCompleteBookingPayment'/,
    );
    expect(REVIEW).toMatch(/bookingPaymentFailure\(attempt\?\.failureReason\)/);
    expect(REVIEW).toMatch(/failureMessage=\{paymentFailure\?\.message\}/);
    // No local copy of the message to drift back to the old promise.
    expect(REVIEW).not.toMatch(/const CHECKOUT_CANCELLED_MESSAGE/);
  });

  it('review only reopens a checkout that is still alive; a ruled-on charge offers Book again', () => {
    const overlay = REVIEW.slice(REVIEW.indexOf('<PaymentProgress'));
    expect(overlay).toMatch(
      /paymentFailure\?\.recovery === 'rebook'\s*\?\s*rebookAfterFailedPayment/,
    );
    expect(overlay).toMatch(/\? 'Book again'/);
    // The rebook re-seeds from the errand it created, through the shared builder.
    const rebook = REVIEW.slice(
      REVIEW.indexOf('const rebookAfterFailedPayment'),
      REVIEW.indexOf('const leaveForBooking'),
    );
    expect(rebook).toMatch(/rebookDraft\(stored\)/);
    expect(rebook).toMatch(/resolveAttempt\(\)/);
  });

  it('tracking leads with "Waiting for your payment", not "Finding you a runner"', () => {
    const pending = TRACKING.slice(
      TRACKING.indexOf("case 'pending':"),
      TRACKING.indexOf("case 'no_runner':", TRACKING.indexOf("case 'pending':")),
    );
    expect(pending).toMatch(/awaitingPayment\s*\?/);
    // Specific about the method — "Waiting for your GCash payment" — through
    // the helper the home card shares (generic wording when it's unknown).
    expect(pending).toMatch(/title: awaitingPaymentHeadline\(booking\)/);
    expect(pending).toMatch(/paymentDeadlineLine\(/);
    // The pill speaks the same truth.
    expect(TRACKING).toMatch(
      /const pillLabel = awaitingPayment\s*\?\s*AWAITING_PAYMENT_LABEL\s*:\s*scheduledFor\s*\?\s*'Scheduled'\s*:\s*STATUS_LABELS\[booking\.status\]/,
    );
  });

  it('tracking tells a paid scheduled errand it is scheduled — not "under a minute"', () => {
    const pending = TRACKING.slice(
      TRACKING.indexOf("case 'pending':"),
      TRACKING.indexOf("case 'no_runner':", TRACKING.indexOf("case 'pending':")),
    );
    expect(TRACKING).toMatch(
      /const scheduledFor = awaitingPayment \? null : scheduledWindowLabel\(booking\)/,
    );
    // Scheduled is checked BEFORE the live-search copy.
    expect(pending.indexOf('scheduledFor')).toBeGreaterThan(-1);
    expect(pending.indexOf('scheduledFor')).toBeLessThan(pending.indexOf("'Finding you a runner'"));
    expect(pending).toMatch(/title: 'Scheduled'/);
    expect(pending).toMatch(/\$\{SCHEDULED_MATCH_LEAD_MINUTES\} minutes before/);
  });

  it('tracking says where a no-runner refund went, above the fold', () => {
    const noRunner = TRACKING.slice(
      TRACKING.indexOf("case 'no_runner':", TRACKING.indexOf("case 'pending':")),
      TRACKING.indexOf("case 'matched':", TRACKING.indexOf("case 'pending':")),
    );
    expect(TRACKING).toMatch(/refundedToWallet\(booking\)/);
    expect(noRunner).toMatch(/noRunnerRefund > 0/);
    expect(noRunner).toMatch(/went back to your ErrandGuy wallet/);
  });

  it('tracking offers the payment ("Pay ₱95.00"), wired to the shared verifier', () => {
    const cta = TRACKING.indexOf('title={payNowLabel(booking)}');
    expect(cta).toBeGreaterThan(-1);
    expect(TRACKING.slice(cta - 300, cta)).toMatch(/awaitingPayment && checkoutUrl \?/);
    expect(TRACKING.slice(cta, cta + 200)).toMatch(/onPress=\{completePayment\}/);
    expect(TRACKING).toMatch(
      /useCompleteBookingPayment\(booking, \{\s*onSettled: fetchBooking,\s*onRebook: \(\) => handleRebook\(\),\s*\}\)/,
    );
    expect(TRACKING).toMatch(/<PaymentProgress \{\.\.\.checkoutProgress\} \/>/);
  });

  it('tracking re-reads the booking while it waits (no realtime event marks a payment)', () => {
    expect(TRACKING).toMatch(/enabled: !!id && awaitingPayment/);
  });

  it('a booking cancelled for being unpaid says so and leads with Book again', () => {
    expect(TRACKING).toMatch(/const cancelledUnpaid = wasCancelledForUnpaidPayment\(booking\)/);
    expect(TRACKING).toMatch(/title: cancelledUnpaid \? UNPAID_CANCEL_TITLE : 'Cancelled'/);
    const cta = TRACKING.indexOf('{cancelledUnpaid && (');
    expect(cta).toBeGreaterThan(-1);
    expect(TRACKING.slice(cta, cta + 300)).toMatch(/title="Book again"/);
    expect(TRACKING.slice(cta, cta + 300)).toMatch(/onPress=\{handleRebook\}/);
  });

  it('every Book again re-seeds through the one shared builder (stops included)', () => {
    const CONFIRM = read('app', '(customer)', 'book', 'confirm.tsx');
    for (const screen of [TRACKING, CONFIRM]) {
      const rebook = screen.slice(screen.indexOf('const handleRebook = useCallback'));
      expect(rebook.slice(0, 600)).toMatch(/updateDraft\(rebookDraft\(b\)\)/);
    }
  });
});

describe('shopping item money is cash at the door', () => {
  it('Review explains it at the moment of commitment', () => {
    expect(REVIEW).toMatch(/Items, paid in cash at the door/);
    expect(REVIEW).toMatch(/Your runner pays for the items\. You repay the receipt amount in/);
  });

  it('Details and Review both enforce the catalog budget ceiling', () => {
    expect(DETAILS).toMatch(/const budgetMax = shoppingBudgetMax\(/);
    expect(DETAILS).toMatch(/shoppingBudgetError\(draftBooking\.shopping_budget, budgetMax\)/);
    expect(DETAILS).toMatch(/helperText=\{`Up to \$\{formatCurrency\(budgetMax\)\}\./);
    // Review re-checks: a rebook lands there without passing Details.
    expect(REVIEW).toMatch(/const budgetMax = shoppingBudgetMax\(/);
    expect(REVIEW).toMatch(/shoppingBudgetError\(draftBooking\.shopping_budget, budgetMax\)/);
  });

  it('tracking tells the customer what cash to have ready, above the fold', () => {
    expect(TRACKING).toMatch(
      /const cashReadyLine =\s*isShopping && itemsDue !== 0 \? itemsCashReadyLine\(booking, fareCashAtDoor\) : null/,
    );
    // On a cash errand the fare is handed over at the same door, so the line
    // names the one total the runner is told to collect.
    expect(TRACKING).toMatch(
      /const fareCashAtDoor =\s*booking\.payment_method === 'cash' && !isTerminalUi \? Number\(booking\.total_amount\) \|\| 0 : 0;/,
    );
    const body = TRACKING.slice(TRACKING.indexOf('When the numeral owns the handle'));
    const cash = body.indexOf('{itemsCashSection}');
    expect(cash).toBeGreaterThan(-1);
    expect(body.indexOf('{detailsSection}')).toBeGreaterThan(cash);
  });

  it('the shopping summary shows the receipt amount, never a wallet refund', () => {
    const start = TRACKING.indexOf('Shopping summary —');
    const card = TRACKING.slice(start, TRACKING.indexOf('Proof photos uploaded', start));
    expect(card).toMatch(/Your budget/);
    expect(card).toMatch(/Receipt amount/);
    expect(card).toMatch(/\{cashReadyLine\}/);
    // No client-side budget − cost arithmetic: there is nothing to refund.
    expect(card).not.toMatch(/shopping_budget\s*-\s*/);
    expect(card).not.toMatch(/wallet/i);
  });

  it("the runner is told the customer repays in cash, matching the cash strip", () => {
    expect(COCKPIT).toMatch(/the customer repays that exact amount in cash at the door/);
    // The collect strip still reads the server's amount_to_collect and calls
    // the item part a reimbursement for what the runner fronted.
    expect(COCKPIT).toMatch(/Collect \{formatCurrency\(amountToCollect\)\} in cash/);
    expect(COCKPIT).toMatch(/you fronted/);
    expect(RECEIPT_MODAL).toMatch(/The customer repays exactly what/);
    expect(RECEIPT_MODAL).not.toMatch(/charge/i);
  });
});

describe("Home's Pay card keeps its payment result on screen", () => {
  it('refreshes Home only once the result is closed, not on the verdict', () => {
    // Home re-renders the card from the list it refetches: refreshing on the
    // verdict unmounted the overlay a second after "Payment confirmed" or
    // "you weren't charged — Book again" appeared.
    const card = readFileSync(
      join(__dirname, '..', '..', 'components', 'customer', 'home', 'AwaitingPaymentCard.tsx'),
      'utf8',
    );
    expect(card).toMatch(/settleOnVerdict: false/);
    const hook = readFileSync(join(__dirname, '..', '..', 'hooks', 'useCompleteBookingPayment.ts'), 'utf8');
    expect(hook).toMatch(/if \(verdict && settleOnVerdictRef\.current\) onSettledRef\.current\?\.\(\)/);
  });
});
