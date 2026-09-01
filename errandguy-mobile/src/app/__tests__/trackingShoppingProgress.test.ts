import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * What the customer can see while the runner shops.
 *
 * Two invariants that only exist as wiring inside the 2.9k-line tracking
 * screen, which cannot be rendered under jest (map, router, sockets, every
 * store). Pinned against the source, the same way trackingArrivalCue.test.ts
 * pins the "server owns the approach push" rule.
 *
 *  1. The status-change /track refetch must KEEP the booking it paid for.
 *     Everything the runner reports at the till — actual_item_cost,
 *     receipt_photo_url, the pickup/delivery proof photos — is written in the
 *     same PATCH that moves the errand forward, and BookingStatusChanged
 *     broadcasts only lifecycle fields. So if this refetch extracts
 *     status_logs and drops the rest (as it used to), the customer's receipt
 *     stays empty until they leave the screen and come back.
 *
 *  2. A runner tick never moves `status`, so nothing keyed on a status change
 *     can surface it. The screen must patch its checklist from the
 *     `shopping_items_updated` broadcast instead.
 */
const SOURCE = readFileSync(
  join(__dirname, '..', '(customer)', 'tracking', '[id].tsx'),
  'utf8',
);

describe('customer tracking — shopping visibility', () => {
  it('keeps the full booking from the status-change /track refetch', () => {
    const start = SOURCE.indexOf('bookingService.trackBooking(id).then(');
    expect(start).toBeGreaterThan(-1);
    const block = SOURCE.slice(start, SOURCE.indexOf('}).catch(() => {});', start));
    // Reads one level deep (data.data.booking), not data.data.
    expect(block).toMatch(/trackRes\.data\.data\?\.booking/);
    // ...and writes it back, not just its status_logs.
    expect(block).toMatch(/setActiveBooking\(fresh\)/);
  });

  it('patches the checklist from the shopping_items_updated broadcast', () => {
    expect(SOURCE).toMatch(/shoppingItemsFromNotification\(/);
    const start = SOURCE.indexOf('const lastTickNotificationRef');
    expect(start).toBeGreaterThan(-1);
    const block = SOURCE.slice(start, SOURCE.indexOf('}, [latestNotification', start));
    // Reads the app-wide realtime sink rather than opening a second socket.
    expect(SOURCE).toMatch(/useNotificationStore\(\(s\) => s\.notifications\[0\]/);
    // Ignores whatever row happened to be at the head of the inbox on mount.
    expect(block).toMatch(/tickWatchArmedRef/);
    // Writes through the store so the home card sees the same ticks. The
    // write is shared with the stops merge, so it spreads conditionally
    // rather than naming shopping_items alone.
    expect(block).toMatch(/setActiveBooking\(\{\s*\.\.\.current,/);
    expect(block).toMatch(/shopping_items: patched/);
  });

  it('merges stop completions from the booking_stops_updated broadcast', () => {
    // Same effect, same channel — a stop tick patches booking.stops by id
    // (the payload is partial, so it must merge, never replace).
    expect(SOURCE).toMatch(/stopCompletionsFromNotification\(/);
    expect(SOURCE).toMatch(/mergeStopCompletions\(/);
    // And the customer can actually SEE the result while the errand runs.
    expect(SOURCE).toMatch(/<StopsProgressCard stops=\{booking\.stops\} live \/>/);
  });

  it('renders the progress card above the collapsed trip details while live', () => {
    const body = SOURCE.slice(SOURCE.indexOf('{!arrivedPinHero ? pinCard : null}'));
    const progressAt = body.indexOf('{shoppingProgressSection}');
    const detailsAt = body.indexOf('{detailsSection}');
    expect(progressAt).toBeGreaterThan(-1);
    expect(detailsAt).toBeGreaterThan(progressAt);
    // The live placement is gated OFF on terminal, where the same card is
    // rendered inside the details disclosure as a record instead.
    expect(SOURCE).toMatch(/const shoppingProgressSection =\s*\n\s*!isTerminalUi && hasShoppingItems/);
  });

  it('falls back to a slow full refetch only when realtime is down', () => {
    const start = SOURCE.indexOf('// Degraded-path fallback for shopping ticks');
    expect(start).toBeGreaterThan(-1);
    const block = SOURCE.slice(start, SOURCE.indexOf('// Phase-aware route target', start));
    expect(block).toMatch(/hasShoppingItems && isShoppingWindow && !realtimeHealthy/);
    expect(block).toMatch(/interval: 45_000/);
    expect(block).toMatch(/runOnMount: false/);
  });
});
