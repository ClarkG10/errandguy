import { lastSupportSender, supportStatusLabel } from '../supportStatus';

/**
 * The server's `pending` means staff answered and the ticket waits on the
 * user — it used to show as "Awaiting reply" on exactly the tickets we had
 * answered. Labels are from the person's point of view, and the newest message
 * decides whose turn it is (a user reply leaves the status at `pending`).
 */
describe('supportStatusLabel', () => {
  it('a ticket staff answered says so', () => {
    expect(supportStatusLabel('pending', 'agent').label).toBe('We replied');
    // Older list rows without a latest message: pending still means we replied.
    expect(supportStatusLabel('pending', null).label).toBe('We replied');
  });

  it('a ticket waiting on staff says so — including after the user writes back', () => {
    expect(supportStatusLabel('open', null).label).toBe('Waiting for our team');
    expect(supportStatusLabel('open', 'user').label).toBe('Waiting for our team');
    expect(supportStatusLabel('pending', 'user').label).toBe('Waiting for our team');
  });

  it('a system note is nobody’s turn', () => {
    expect(supportStatusLabel('pending', 'system').label).toBe('We replied');
    expect(supportStatusLabel('open', 'system').label).toBe('Waiting for our team');
  });

  it('finished tickets read as finished', () => {
    expect(supportStatusLabel('resolved', 'agent').label).toBe('Resolved');
    expect(supportStatusLabel('closed', 'user').label).toBe('Closed');
  });

  it('never says "Awaiting reply"', () => {
    for (const status of ['open', 'pending', 'resolved', 'closed'] as const) {
      for (const sender of ['user', 'agent', 'system', null] as const) {
        expect(supportStatusLabel(status, sender).label).not.toMatch(/awaiting/i);
      }
    }
  });
});

describe('lastSupportSender', () => {
  it('skips system notes and reads the newest real message', () => {
    expect(
      lastSupportSender([
        { sender_type: 'user' },
        { sender_type: 'agent' },
        { sender_type: 'system' },
      ]),
    ).toBe('agent');
    expect(lastSupportSender([{ sender_type: 'agent' }, { sender_type: 'user' }])).toBe('user');
    expect(lastSupportSender([])).toBeNull();
  });
});
