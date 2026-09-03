import { formatRating, UNRATED_LABEL } from '../rating';

describe('formatRating', () => {
  it('renders a runner with no reviews as New, with no stars to draw', () => {
    const r = formatRating(0, 0);
    expect(r.isUnrated).toBe(true);
    expect(r.label).toBe(UNRATED_LABEL);
    expect(r.stars).toBe(0);
    expect(r.countLabel).toBeNull();
    expect(r.a11yLabel).toBe('New — no ratings yet');
  });

  it('treats a missing / unparseable average as unrated, never 0.0', () => {
    for (const value of [null, undefined, '', 'n/a', 0, '0', '0.00']) {
      expect(formatRating(value).label).toBe(UNRATED_LABEL);
    }
  });

  it('treats an explicit zero review count as unrated even with a stray average', () => {
    expect(formatRating(4.5, 0).isUnrated).toBe(true);
  });

  it('formats a real score to one decimal and rounds the stars', () => {
    const r = formatRating('4.82', 12);
    expect(r.isUnrated).toBe(false);
    expect(r.label).toBe('4.8');
    expect(r.stars).toBe(5);
    expect(r.countLabel).toBe('12 reviews');
    expect(r.a11yLabel).toBe('Rated 4.8 out of 5 from 12 reviews');
  });

  it('says "review", not "reviews", at one — and never says "trips"', () => {
    const r = formatRating(5, 1);
    expect(r.countLabel).toBe('1 review');
    expect(r.a11yLabel).not.toContain('trip');
  });

  it('omits the count when the server did not send one', () => {
    const r = formatRating(4.2);
    expect(r.label).toBe('4.2');
    expect(r.countLabel).toBeNull();
    expect(r.a11yLabel).toBe('Rated 4.2 out of 5');
  });
});
