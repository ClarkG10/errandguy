import dayjs from 'dayjs';
import { scheduledWindowLabel, SCHEDULED_MATCH_LEAD_MINUTES } from '../scheduledBooking';

const base = { status: 'pending' as const, schedule_type: 'scheduled' as const };

describe('scheduledWindowLabel', () => {
  it('labels a booking whose window has not opened yet', () => {
    const at = dayjs().add(2, 'day').hour(9).minute(0);
    expect(scheduledWindowLabel({ ...base, scheduled_at: at.toISOString() })).toContain('9:00 AM');
  });

  it('returns null once the matching window has opened — the search is real now', () => {
    const at = dayjs().add(SCHEDULED_MATCH_LEAD_MINUTES - 5, 'minute');
    expect(scheduledWindowLabel({ ...base, scheduled_at: at.toISOString() })).toBeNull();
  });

  it('ignores immediate bookings', () => {
    expect(
      scheduledWindowLabel({
        status: 'pending',
        schedule_type: 'now',
        scheduled_at: null,
      } as never),
    ).toBeNull();
  });

  it('ignores bookings that already have a runner', () => {
    const at = dayjs().add(2, 'day');
    expect(
      scheduledWindowLabel({
        ...base,
        status: 'accepted',
        scheduled_at: at.toISOString(),
      } as never),
    ).toBeNull();
  });

  it('tolerates a malformed timestamp rather than throwing', () => {
    expect(scheduledWindowLabel({ ...base, scheduled_at: 'not-a-date' })).toBeNull();
  });
});
