/**
 * How a runner's (or customer's) star rating is PRESENTED.
 *
 * `avg_rating` is 0 for someone with no reviews yet — ReviewController computes
 * it as the average over an empty set. Printed raw that reads as "0.0 stars",
 * i.e. the worst-rated operator on the platform, which is exactly the wrong
 * thing to show a customer who has just been matched and is deciding whether to
 * cancel. It is also demoralising on the runner's own dashboard.
 *
 * The runner's profile screen already got this right ("New" plus no stars); this
 * is that treatment lifted out so every surface says the same thing.
 *
 * Also fixes the noun: `total_ratings` is COUNT(*) of reviews
 * (ReviewController), not completed errands, so a runner with 50 errands and 8
 * reviews must never be advertised as "8 trips". Volume is `total_errands` and
 * is called "errands" on the runner's own profile; the count next to a score is
 * reviews.
 *
 * Pure and RN-free (like `formatCurrency` / `errandTypeOrder`) so it stays
 * trivially unit-testable.
 */

/** What an unrated operator is called, everywhere. */
export const UNRATED_LABEL = 'New';

export interface RatingDisplay {
  /** No reviews yet — callers must NOT draw stars (empty stars read as 0/5). */
  isUnrated: boolean;
  /** 'New' or '4.8'. */
  label: string;
  /** Rounded value for <RatingStars>; 0 while unrated. */
  stars: number;
  /** '8 reviews' / '1 review', or null when there is nothing to count. */
  countLabel: string | null;
  /** Ready-made sentence for accessibilityLabel. */
  a11yLabel: string;
}

/**
 * @param avgRating   `avg_rating` as it arrives (number, numeric string, null).
 * @param totalRatings `total_ratings` — the REVIEW count, when known.
 */
export function formatRating(
  avgRating: number | string | null | undefined,
  totalRatings?: number | string | null,
): RatingDisplay {
  const avg = Number(avgRating);
  const count = Number(totalRatings);
  const hasCount = Number.isFinite(count) && count > 0;

  // Unrated when there is no positive average, and also when the server
  // explicitly says zero reviews (a stray average with no reviews behind it is
  // not something to advertise).
  const isUnrated =
    !Number.isFinite(avg) ||
    avg <= 0 ||
    (totalRatings != null && Number.isFinite(count) && count <= 0);

  if (isUnrated) {
    return {
      isUnrated: true,
      label: UNRATED_LABEL,
      stars: 0,
      countLabel: null,
      a11yLabel: 'New — no ratings yet',
    };
  }

  const label = avg.toFixed(1);
  const countLabel = hasCount
    ? `${count} ${count === 1 ? 'review' : 'reviews'}`
    : null;

  return {
    isUnrated: false,
    label,
    stars: Math.round(avg),
    countLabel,
    a11yLabel: `Rated ${label} out of 5${countLabel ? ` from ${countLabel}` : ''}`,
  };
}
