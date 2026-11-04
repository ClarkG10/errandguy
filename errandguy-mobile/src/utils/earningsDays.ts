import type { Booking } from '../types';
import { formatWeekdayMonthDay } from './formatDate';

/**
 * Day groups and the week chart on the runner's Earnings tab.
 *
 * Both used to be added up on the phone from ONE page of up to 100 errands.
 * A runner with more completed errands than that in the month (or a busy
 * week) lost the oldest days from the groups and the bars — smaller numbers
 * than they had earned, under a hero total that was right. The day totals now
 * come from GET /runner/earnings/daily, summed by the server over the whole
 * period, and the list of errands under them loads a page at a time.
 */

/** Rows per page of the per-errand list (GET /runner/earnings/history). */
export const EARNINGS_PAGE_SIZE = 30;

/** Asia/Manila (UTC+8, no daylight saving) — what the server buckets on. */
export const BUSINESS_UTC_OFFSET_MINUTES = 480;

/** One business-calendar day of GET /runner/earnings/daily. */
export interface EarningsDay {
  /** 'YYYY-MM-DD' on the Manila calendar. */
  date: string;
  errands: number;
  /** Runner payout only — tips are never folded in. */
  earnings: number;
  tips: number;
  /** Paid in cash at the door; null when an errand that day has no method on record. */
  cash_earnings: number | null;
}

export interface EarningsDaily {
  days: EarningsDay[];
  utcOffsetMinutes: number;
}

export interface EarningsDayGroup {
  /** The day's 'YYYY-MM-DD' (or 'unknown' for a row with no usable date). */
  key: string;
  /** "Today", "Yesterday" or "Monday, Nov 3". */
  label: string;
  /** The whole day's payout, not just the rows loaded so far. */
  total: number;
  /** The day's errands loaded so far, newest first. */
  data: Booking[];
}

export interface WeekChart {
  /** Monday … Sunday of this business week. */
  totals: number[];
  max: number;
  bestIdx: number;
  todayIdx: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const cents = (n: number) => Math.round(n * 100);

const toNumber = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The daily payload, or null when there isn't a usable one (an older server
 * without the endpoint, a malformed body). Null means "fall back to adding up
 * the loaded rows", exactly as the tab did before.
 */
export function parseEarningsDaily(payload: unknown): EarningsDaily | null {
  const p = payload as { days?: unknown; utc_offset_minutes?: unknown } | null | undefined;
  if (!p || !Array.isArray(p.days)) return null;
  const offset = Number(p.utc_offset_minutes);
  const days: EarningsDay[] = [];
  for (const raw of p.days as Array<Record<string, unknown> | null>) {
    const date = typeof raw?.date === 'string' ? raw.date : '';
    if (!DATE_RE.test(date)) continue;
    const cash = raw?.cash_earnings;
    days.push({
      date,
      errands: toNumber(raw?.errands),
      earnings: toNumber(raw?.earnings),
      tips: toNumber(raw?.tips),
      cash_earnings: cash == null || !Number.isFinite(Number(cash)) ? null : Number(cash),
    });
  }
  return {
    days,
    utcOffsetMinutes: Number.isFinite(offset) ? offset : BUSINESS_UTC_OFFSET_MINUTES,
  };
}

/** The business-calendar 'YYYY-MM-DD' of an instant, or null when it isn't a date. */
export function businessDate(
  instant: string | number | Date | null | undefined,
  offsetMinutes: number = BUSINESS_UTC_OFFSET_MINUTES,
): string | null {
  if (instant == null || instant === '') return null;
  const ms = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' plus n calendar days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Rows once each: pages can overlap when an errand completes between loads. */
export function uniqueRows(rows: Booking[]): Booking[] {
  const seen = new Set<string>();
  const out: Booking[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/**
 * Payout per business day. The server's whole-day total where it has one;
 * the loaded rows' own sum where it doesn't (an older server, or the endpoint
 * failed). If the rows already loaded add up to MORE than the server's figure,
 * that figure is from before the newest errand — the rows win, since a day
 * can't have earned less than the errands on screen.
 */
export function dayTotals(rows: Booking[], daily: EarningsDaily | null): Map<string, number> {
  const offset = daily?.utcOffsetMinutes ?? BUSINESS_UTC_OFFSET_MINUTES;
  const fromRows = new Map<string, number>();
  for (const row of uniqueRows(rows)) {
    const date = businessDate(row.completed_at ?? row.created_at, offset);
    if (!date) continue;
    // runner_payout is a Laravel decimal cast → JSON STRING ("14.60"); add
    // numbers, never strings. Payout only, never the customer's total.
    fromRows.set(date, (fromRows.get(date) ?? 0) + cents(toNumber(row.runner_payout)));
  }
  const totals = new Map<string, number>();
  for (const day of daily?.days ?? []) totals.set(day.date, cents(day.earnings));
  for (const [date, sum] of fromRows) {
    totals.set(date, Math.max(totals.get(date) ?? 0, sum));
  }
  for (const [date, c] of totals) totals.set(date, c / 100);
  return totals;
}

/**
 * The loaded rows grouped by business day, newest day first, each headed by
 * the WHOLE day's total — so a day whose later errands are still on the next
 * page already shows what it really paid.
 */
export function groupEarningsByDay(
  rows: Booking[],
  daily: EarningsDaily | null,
  now: number = Date.now(),
): EarningsDayGroup[] {
  const offset = daily?.utcOffsetMinutes ?? BUSINESS_UTC_OFFSET_MINUTES;
  const today = businessDate(now, offset) ?? '';
  const yesterday = today ? addDays(today, -1) : '';
  const totals = dayTotals(rows, daily);
  const groups = new Map<string, EarningsDayGroup>();
  for (const row of uniqueRows(rows)) {
    const key = businessDate(row.completed_at ?? row.created_at, offset) ?? 'unknown';
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label:
          key === today
            ? 'Today'
            : key === yesterday
              ? 'Yesterday'
              : key === 'unknown'
                ? ''
                : formatWeekdayMonthDay(key),
        total: totals.get(key) ?? 0,
        data: [],
      };
      groups.set(key, group);
    }
    group.data.push(row);
  }
  if (groups.has('unknown')) {
    const unknown = groups.get('unknown')!;
    unknown.total = cents(unknown.data.reduce((s, r) => s + toNumber(r.runner_payout), 0)) / 100;
  }
  // 'unknown' sorts after every date; dates sort newest first as strings.
  return Array.from(groups.values()).sort((a, b) =>
    a.key === 'unknown' ? 1 : b.key === 'unknown' ? -1 : a.key < b.key ? 1 : a.key > b.key ? -1 : 0,
  );
}

/**
 * Monday–Sunday bars for this business week, zero-filled so a quiet day reads
 * as a gap instead of disappearing.
 */
export function buildWeekChart(
  rows: Booking[],
  daily: EarningsDaily | null,
  now: number = Date.now(),
): WeekChart {
  const offset = daily?.utcOffsetMinutes ?? BUSINESS_UTC_OFFSET_MINUTES;
  const today = businessDate(now, offset) as string;
  const [y, m, d] = today.split('-').map(Number);
  const todayIdx = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday → 0
  const monday = addDays(today, -todayIdx);
  const byDay = dayTotals(rows, daily);
  const totals = Array.from({ length: 7 }, (_, i) => byDay.get(addDays(monday, i)) ?? 0);
  const max = Math.max(...totals);
  return { totals, max, bestIdx: max > 0 ? totals.indexOf(max) : -1, todayIdx };
}

/**
 * The hero's cash-in-hand vs paid-online split from the server's day totals,
 * so it no longer needs every errand loaded. Null unless every day says how
 * it was paid and the days add up to the hero total to the centavo — a stale
 * or partial answer hides the split rather than show one that disagrees with
 * the number above it.
 */
export function splitFromDays(
  daily: EarningsDaily | null,
  serverTotal: number | null | undefined,
): { cash: number; wallet: number } | null {
  if (!daily || !daily.days.length || serverTotal == null) return null;
  let cash = 0;
  let all = 0;
  for (const day of daily.days) {
    if (day.cash_earnings == null) return null;
    cash += cents(day.cash_earnings);
    all += cents(day.earnings);
  }
  if (all !== cents(Number(serverTotal))) return null;
  return { cash: cash / 100, wallet: (all - cash) / 100 };
}
