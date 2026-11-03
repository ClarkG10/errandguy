import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * "When?" is now a side trip from Review rather than a step every booking
 * walks through. The schedule and review screens can't be rendered under jest
 * (router, maps, half a dozen stores), so — like runnerJourneyConvenience —
 * the behaviour is pinned against the source.
 */
const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SCHEDULE = stripComments(read('(customer)', 'book', 'schedule.tsx'));
const REVIEW = stripComments(read('(customer)', 'book', 'review.tsx'));

describe('the schedule screen', () => {
  it('keeps a picked time on the screen until Continue, so Back changes nothing', () => {
    expect(SCHEDULE).toContain('useState<string | undefined>(draftBooking.scheduled_at)');
    expect(SCHEDULE).not.toContain('updateDraft({ scheduled_at: iso })');
    expect(SCHEDULE).not.toContain('updateDraft({ scheduled_at: isoString })');
    expect(SCHEDULE).toContain("scheduled_at: scheduleType === 'now' ? undefined : pickedAt");
  });
});

describe('Review', () => {
  it('never shows "Now" for an errand set to Later with no time yet', () => {
    expect(REVIEW).toContain("draftBooking.schedule_type === 'scheduled' && !draftBooking.scheduled_at");
    expect(REVIEW).toContain("'Later · no time picked'");
    expect(REVIEW).toContain("'Pick a time for your errand first.'");
  });
});
