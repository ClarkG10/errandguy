import fs from 'fs';
import path from 'path';

/**
 * A runner with no reviews has avg_rating 0. Printed raw on the customer's
 * tracking screen that read as "0.0" — the worst-rated operator on the
 * platform — beside the runner the customer has just been matched with and is
 * deciding whether to cancel on. It also mislabelled the review count as
 * "trips".
 *
 * Source-shape test (the screen is ~2900 lines and not render-testable in
 * isolation): pins that the raw formatting is gone and the shared helper owns
 * the presentation. formatRating's own branches are covered by
 * utils/__tests__/rating.test.ts.
 */
const SOURCE = fs.readFileSync(
  path.join(__dirname, '../(customer)/tracking/[id].tsx'),
  'utf8',
);

describe('customer tracking — the runner is never shown as a 0.0-star operator', () => {
  it('routes the runner rating through formatRating', () => {
    expect(SOURCE).toMatch(/import \{ formatRating \} from '\.\.\/\.\.\/\.\.\/utils\/rating'/);
    expect(SOURCE).toMatch(/formatRating\(\s*booking\.runner\?\.avg_rating/);
  });

  it('no longer prints a raw toFixed(1) average for the runner', () => {
    expect(SOURCE).not.toMatch(/Number\(booking\.runner\?\.avg_rating \?\? 0\)\.toFixed\(1\)/);
  });

  it('draws no stars while unrated — empty stars read as 0 out of 5', () => {
    expect(SOURCE).toMatch(/!runnerRating\.isUnrated && \(\s*<RatingStars/);
  });

  it('stops calling the review count "trips"', () => {
    expect(SOURCE).not.toMatch(/total_ratings\} trips/);
    expect(SOURCE).toMatch(/runnerRating\.countLabel/);
  });
});
