import {
  BUSINESS_UTC_OFFSET_MINUTES,
  addDays,
  businessDate,
  buildWeekChart,
  dayTotals,
  groupEarningsByDay,
  parseEarningsDaily,
  splitFromDays,
  type EarningsDaily,
} from '../earningsDays';
import type { Booking } from '../../types';

/**
 * The Earnings tab's day groups and week chart used to be added up on the
 * phone from one page of up to 100 errands, so a busy month dropped its
 * oldest days. They are built from GET /runner/earnings/daily now — the
 * server's per-Manila-day totals over the whole period — with the loaded rows
 * only deciding which errands are listed under each day.
 */

// Wed 2 Sep 2026, 14:00 in Manila (06:00 UTC).
const NOW = Date.parse('2026-09-02T06:00:00Z');

const row = (id: string, completedAtUtc: string, payout: number | string, method = 'gcash'): Booking =>
  ({
    id,
    status: 'completed',
    completed_at: completedAtUtc,
    created_at: completedAtUtc,
    runner_payout: payout,
    payment_method_type: method,
  }) as unknown as Booking;

const daily = (days: EarningsDaily['days']): EarningsDaily => ({
  days,
  utcOffsetMinutes: BUSINESS_UTC_OFFSET_MINUTES,
});

const day = (date: string, errands: number, earnings: number, cash: number | null = 0) => ({
  date,
  errands,
  earnings,
  tips: 0,
  cash_earnings: cash,
});

describe('business dates', () => {
  it('puts 23:30 Manila on that Manila day, and 00:30 on the next', () => {
    // 23:30 Manila on 1 Sep is 15:30 UTC that day; 00:30 Manila on 2 Sep is
    // 16:30 UTC on the 1st — one UTC date, two Manila dates.
    expect(businessDate('2026-09-01T15:30:00.000000Z')).toBe('2026-09-01');
    expect(businessDate('2026-09-01T16:30:00.000000Z')).toBe('2026-09-02');
    expect(businessDate(null)).toBeNull();
    expect(businessDate('not a date')).toBeNull();
  });

  it('steps calendar days across month ends', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
  });
});

describe('parsing GET /runner/earnings/daily', () => {
  it('reads the days, with amounts sent as strings', () => {
    const parsed = parseEarningsDaily({
      utc_offset_minutes: 480,
      days: [{ date: '2026-09-02', errands: '3', earnings: '312.50', tips: '20', cash_earnings: '100' }],
    });
    expect(parsed).toEqual({
      utcOffsetMinutes: 480,
      days: [{ date: '2026-09-02', errands: 3, earnings: 312.5, tips: 20, cash_earnings: 100 }],
    });
  });

  it('keeps an unknown cash share as null, and skips a row with no date', () => {
    const parsed = parseEarningsDaily({
      days: [{ date: '2026-09-02', errands: 1, earnings: 50, cash_earnings: null }, { errands: 2 }],
    });
    expect(parsed?.days).toEqual([
      { date: '2026-09-02', errands: 1, earnings: 50, tips: 0, cash_earnings: null },
    ]);
    expect(parsed?.utcOffsetMinutes).toBe(480);
  });

  it('is null without a usable payload, so the tab adds up its rows instead', () => {
    expect(parseEarningsDaily(undefined)).toBeNull();
    expect(parseEarningsDaily({})).toBeNull();
    expect(parseEarningsDaily({ days: 'nope' })).toBeNull();
  });
});

describe('day groups', () => {
  it('heads each day with the server’s whole-day total, not the rows loaded so far', () => {
    // 30 of today's 45 errands are on page 1; the rest are on page 2.
    const rows = Array.from({ length: 30 }, (_, i) =>
      row(`r${i}`, '2026-09-02T05:00:00.000000Z', '100.00'),
    );
    const groups = groupEarningsByDay(rows, daily([day('2026-09-02', 45, 4500)]), NOW);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Today');
    expect(groups[0].total).toBe(4500);
    expect(groups[0].data).toHaveLength(30);
  });

  it('files a 23:30 Manila errand under that day, labelled Yesterday', () => {
    const late = row('late', '2026-09-01T15:30:00.000000Z', 130); // 23:30 Manila, 1 Sep
    const early = row('early', '2026-09-01T16:30:00.000000Z', 140); // 00:30 Manila, 2 Sep
    const groups = groupEarningsByDay(
      [early, late],
      daily([day('2026-09-02', 1, 140), day('2026-09-01', 1, 130)]),
      NOW,
    );

    expect(groups.map((g) => [g.label, g.total, g.data.map((r) => r.id)])).toEqual([
      ['Today', 140, ['early']],
      ['Yesterday', 130, ['late']],
    ]);
  });

  it('names older days, newest first, and lists each row once', () => {
    const a = row('a', '2026-08-30T04:00:00Z', 50);
    const groups = groupEarningsByDay([a, a], daily([day('2026-08-30', 1, 50)]), NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Sunday, Aug 30');
    expect(groups[0].data).toHaveLength(1);
  });

  it('falls back to adding up the loaded rows when there are no server totals', () => {
    const rows = [
      row('a', '2026-09-02T01:00:00Z', '14.60'),
      row('b', '2026-09-02T02:00:00Z', '20.40'),
    ];
    // Strings must ADD, not concatenate ("14.6020.40" → NaN).
    expect(groupEarningsByDay(rows, null, NOW)[0].total).toBe(35);
  });

  it('never shows a day as earning less than the errands already on screen', () => {
    // The server figure predates the newest errand.
    const rows = [row('a', '2026-09-02T01:00:00Z', 100), row('b', '2026-09-02T02:00:00Z', 100)];
    expect(dayTotals(rows, daily([day('2026-09-02', 1, 100)])).get('2026-09-02')).toBe(200);
  });
});

describe('the week chart', () => {
  it('is Monday–Sunday of the Manila week, zero-filled, from the server totals', () => {
    const chart = buildWeekChart(
      [],
      daily([day('2026-09-02', 45, 4500), day('2026-09-01', 10, 1000), day('2026-08-31', 5, 600)]),
      NOW,
    );
    expect(chart.totals).toEqual([600, 1000, 4500, 0, 0, 0, 0]);
    expect(chart.todayIdx).toBe(2);
    expect(chart.bestIdx).toBe(2);
    expect(chart.max).toBe(4500);
  });

  it('starts the week on the Manila Monday even when it is still Sunday in UTC', () => {
    // Mon 7 Sep 03:00 Manila = Sun 6 Sep 19:00 UTC.
    const chart = buildWeekChart([], daily([day('2026-09-07', 1, 300)]), Date.parse('2026-09-06T19:00:00Z'));
    expect(chart.todayIdx).toBe(0);
    expect(chart.totals[0]).toBe(300);
  });

  it('keeps last week out', () => {
    const chart = buildWeekChart([], daily([day('2026-08-30', 3, 999)]), NOW);
    expect(chart.totals).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(chart.bestIdx).toBe(-1);
  });
});

describe('cash in hand vs paid online', () => {
  it('comes from the day totals when they add up to the hero', () => {
    const d = daily([day('2026-09-02', 3, 300, 100), day('2026-09-01', 2, 200, 0)]);
    expect(splitFromDays(d, 500)).toEqual({ cash: 100, wallet: 400 });
  });

  it('is hidden when a day has no method on record, or the days disagree with the hero', () => {
    expect(splitFromDays(daily([day('2026-09-02', 1, 300, null)]), 300)).toBeNull();
    expect(splitFromDays(daily([day('2026-09-02', 1, 300, 100)]), 450)).toBeNull();
    expect(splitFromDays(null, 300)).toBeNull();
    expect(splitFromDays(daily([]), 0)).toBeNull();
  });
});
