import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * What survives the end of an errand.
 *
 * Three invariants that only exist as wiring inside the 3k-line tracking
 * screen, which cannot be rendered (or even imported) under jest — the map,
 * router, sockets, reanimated Keyframes and every store come with it. Pinned
 * against the source, the same way trackingArrivalCue.test.ts pins the
 * "server owns the approach push" rule.
 *
 *  1. A COMPLETED errand stays reachable as a receipt. The sweep to /rate
 *     used to sit outside the status-changed guard, so it also fired from the
 *     mount fetch: Activity → "View full details", search and notification
 *     taps all bounced to the rating screen, which on an already-rated errand
 *     renders an empty form whose Submit 422s forever. The proof photos,
 *     signature, shopping reconciliation and stage timeline live ONLY on this
 *     receipt.
 *  2. A CANCELLED errand says what it cost. The server records a fee, refunds
 *     the remainder to the wallet and flips payment_status — and none of it
 *     appeared anywhere once the cancel toast faded.
 *  3. Actions that cannot work on a finished errand are gone. The trip-share
 *     endpoint excludes completed/cancelled bookings (guaranteed 404), and
 *     Call dials the runner of a job that no longer exists — while `delivered`
 *     deliberately keeps both (its post-dropoff safety window is still live).
 */
const SOURCE = readFileSync(
  join(__dirname, '..', '(customer)', 'tracking', '[id].tsx'),
  'utf8',
);

describe('customer tracking — the terminal receipt', () => {
  it('only sweeps to /rate on a live completion the customer just watched', () => {
    const replace = SOURCE.indexOf('router.replace(`/(customer)/rate/');
    expect(replace).toBeGreaterThan(-1);
    // The redirect must live INSIDE the status-changed block, i.e. after the
    // `const prev = lastSyncedStatusRef.current` that block opens with.
    const guard = SOURCE.indexOf('const prev = lastSyncedStatusRef.current');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(replace);

    const condition = SOURCE.slice(
      SOURCE.lastIndexOf('if (', replace),
      replace,
    );
    // A transition, not a mount seed or a re-delivery of the same status.
    expect(condition).toMatch(/prev != null/);
    expect(condition).toMatch(/prev !== 'completed'/);
    // ...and never for an errand that already carries the customer's review.
    expect(condition).toMatch(/!bookingReview\(activeBooking\)/);
  });

  it('keeps rating reachable from the receipt itself', () => {
    expect(SOURCE).toMatch(/title="Rate your runner"/);
    const cta = SOURCE.indexOf('title="Rate your runner"');
    const block = SOURCE.slice(cta - 400, cta);
    expect(block).toMatch(/booking\.status === 'completed' && !hasReview/);
  });

  it('renders the money outcome on a cancelled / unmatched receipt', () => {
    // Rendered from the server's derived fields, never recomputed here.
    expect(SOURCE).toMatch(/const money = bookingMoneyOutcome\(booking\)/);
    expect(SOURCE).toMatch(/const moneyOutcomeSection = isMoneyOutcome \?/);
    expect(SOURCE).toMatch(/\{moneyOutcomeSection\}/);

    const section = SOURCE.slice(
      SOURCE.indexOf('const moneyOutcomeSection'),
      SOURCE.indexOf('// Quiet report-a-problem link'),
    );
    expect(section).toMatch(/Cancellation fee/);
    expect(section).toMatch(/Refunded to your ErrandGuy wallet/);
    expect(section).toMatch(/Nothing was charged for this errand/);
    // The reason the server recorded, which no screen used to show.
    expect(section).toMatch(/booking\.cancellation_reason/);
    // No client-side money arithmetic anywhere in the block.
    expect(section).not.toMatch(/total_amount\s*-\s*/);
  });

  it('offers a rebook on a cancelled errand, not just "report a problem"', () => {
    const cta = SOURCE.indexOf('title="Rebook this errand"');
    expect(cta).toBeGreaterThan(-1);
    expect(SOURCE.slice(cta - 300, cta)).toMatch(
      /booking\.status === 'cancelled'/,
    );
  });

  it('drops Call and Share once the errand is over, keeping Message', () => {
    // Narrower than isTerminalUi on purpose — `delivered` keeps both.
    const isFinished = SOURCE.slice(
      SOURCE.indexOf('const isFinished ='),
      SOURCE.indexOf('const isMoneyOutcome ='),
    );
    expect(isFinished).toMatch(/'completed'/);
    expect(isFinished).toMatch(/'cancelled'/);
    expect(isFinished).not.toMatch(/'delivered'/);

    const card = SOURCE.slice(
      SOURCE.indexOf('const runnerCard = booking.runner_id'),
      SOURCE.indexOf('// Trip route — the timeline stays surfaced'),
    );
    // Call chip gated…
    const call = card.indexOf('accessibilityLabel="Call runner"');
    expect(call).toBeGreaterThan(-1);
    expect(card.slice(0, call)).toMatch(/\{!isFinished && \($/m);
    // …Share chip gated…
    const share = card.indexOf('onPress={handleShareTrip}');
    expect(share).toBeGreaterThan(-1);
    expect(card.slice(0, share).lastIndexOf('{!isFinished && (')).toBeGreaterThan(
      call,
    );
    // …and the chat chip left alone (read-only history is legitimate).
    const chat = card.indexOf('/(customer)/chat/');
    expect(chat).toBeGreaterThan(-1);
    expect(card.slice(card.lastIndexOf('<Pressable', chat), chat)).not.toMatch(
      /isFinished/,
    );
  });

  it('explains a closed cancel window on every errand type, not just shopping', () => {
    const notice = SOURCE.slice(
      SOURCE.indexOf('const cancelClosedNotice ='),
      SOURCE.indexOf('// Quiet report-a-problem link'),
    );
    // Shows for any errand past the cancellable window while still live.
    expect(notice).toMatch(/!isTerminalUi && !canCancel \?/);
    // Shopping keeps its specific line; everything else gets the general one.
    expect(notice).toMatch(/already paid for the items/);
    expect(notice).toMatch(/self-cancel is closed/);
    // ...and it routes to the support path that can still help.
    expect(notice).toMatch(/handleReportProblem\('booking'\)/);
  });

  it('states the refund, not just the fee, in the cancel confirmation', () => {
    const lines = SOURCE.slice(
      SOURCE.indexOf('export function cancelMoneyLines'),
      SOURCE.indexOf('const MAP_PHASES'),
    );
    expect(lines).toMatch(/Cancellation fee: /);
    expect(lines).toMatch(/Back to your ErrandGuy wallet: /);
    // Reads the additive preview fields rather than deriving a refund.
    expect(lines).toMatch(/p\.refund_amount/);
    expect(lines).toMatch(/p\.refund_destination === 'wallet'/);

    const modal = SOURCE.slice(
      SOURCE.indexOf('visible={showCancelModal}'),
      SOURCE.indexOf('cancelLabel="Keep booking"'),
    );
    expect(modal).toMatch(/cancelMoneyLines\(cancelPreview\)/);
    // The old confirm label ("Cancel & pay ₱20") read as a fresh charge on
    // money the customer had already been charged.
    expect(modal).not.toMatch(/`Cancel & pay/);
    expect(modal).toMatch(/'Cancel errand'/);
  });
});
