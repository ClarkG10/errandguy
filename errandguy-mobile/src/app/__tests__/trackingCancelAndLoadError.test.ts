import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Two dead ends on the customer's tracking screen, pinned against the source
 * (the screen needs the map, realtime and the whole api graph to render; the
 * waiting screen's cancel — same ConfirmModal wiring — is render-tested in
 * book/__tests__/waitingForRunner).
 *
 *  • Cancel could be confirmed while the body still said "Checking…", i.e.
 *    before the fee was shown; and a failed fee check fell back to generic
 *    copy that never mentioned a fee.
 *  • "Couldn't load this errand" had Retry only — a 404 never succeeds, and
 *    from a cold-start push there's no screen behind it to go back to.
 */
const SOURCE = readFileSync(join(__dirname, '..', '(customer)', 'tracking', '[id].tsx'), 'utf8');

describe('tracking — cancel waits for the fee', () => {
  const modal = SOURCE.slice(
    SOURCE.indexOf('visible={showCancelModal}'),
    SOURCE.indexOf('cancelLabel="Keep errand"'),
  );

  it('holds the confirm until the preview has resolved', () => {
    expect(modal).toContain('confirmDisabled={previewLoading');
    expect(modal).toContain("'Checking for a cancellation fee…'");
  });

  it('says a fee may apply when the check failed, and offers to check again', () => {
    expect(modal).toContain(': CANCEL_PREVIEW_FAILED');
    expect(SOURCE).toMatch(/If a runner has already accepted your errand, a small fee may apply/);
    expect(modal).toMatch(/previewFailed && !previewLoading\s*\?\s*\{ label: 'Check the fee again', onPress: loadCancelPreview \}/);
  });

  it('calls it an errand', () => {
    expect(modal).toContain('title="Cancel errand?"');
    expect(SOURCE).not.toMatch(/Cancel booking\?|Keep booking|Cancel Errand"/);
  });
});

describe('tracking — a load failure has a way out', () => {
  const block = SOURCE.slice(SOURCE.indexOf('if (!booking) {'), SOURCE.indexOf('const errandRule ='));

  it('says why it failed and offers Go to Home next to Retry', () => {
    expect(block).toContain('error={loadError}');
    expect(block).toContain('onRetry={retryLoad}');
    expect(block).toContain('secondaryActionLabel="Go to Home"');
  });

  it('sends a 404 to "Errand not found" instead of a Retry that can never work', () => {
    expect(block).toMatch(/\.status !== 404/);
    expect(block).toContain('Errand not found');
    expect(block).not.toContain('Booking not found');
  });
});

describe('tracking — a cancel whose answer was lost', () => {
  const handler = SOURCE.slice(
    SOURCE.indexOf('const confirmCancel = useCallback'),
    SOURCE.indexOf('const handleSOS = useCallback'),
  );
  const failure = handler.slice(handler.indexOf('} catch (err) {'));

  it('re-reads the errand before saying the cancel failed', () => {
    expect(failure).toContain('cancelAppliedAnyway(err,');
    expect(failure).toContain('bookingService.getBooking(id, { fresh: true })');
    // Landed after all: the normal success ending, not the error.
    const landed = failure.slice(failure.indexOf('if (landed) {'), failure.indexOf('return;'));
    expect(landed).toContain("router.replace('/(customer)/(tabs)')");
    expect(landed).toContain('toast.success(copy.booking.cancelled)');
  });

  it('stops claiming a cancel that did not happen, so a later one is announced', () => {
    const notLanded = failure.slice(failure.indexOf('return;'));
    expect(notLanded).toMatch(/selfCancelledRef\.current = false;[\s\S]*toast\.error\(errorMessage\(err, copy\.booking\.cancelFailed\)\)/);
  });
});
