import fs from 'fs';
import path from 'path';
import React from 'react';
import { render } from '@testing-library/react-native';
import { IncomingRequestModal } from '../../components/runner/IncomingRequestModal';
import { makeBooking } from '../../__mocks__/factories';
import type { Booking } from '../../types';

/**
 * An errand that is only OFFERED (status `matched`) must not show the runner
 * the customer's phone or the pickup/drop-off contact numbers — a runner who
 * declines (or never answers) should leave with nobody's number. A newer
 * server stops sending them until accept; the app hides them either way, so
 * an older server's payload can't leak them.
 */
const COCKPIT = fs
  .readFileSync(path.join(__dirname, '..', '(runner)', 'errand', '[id].tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const offerWithContacts = (): Booking =>
  ({
    ...makeBooking({ status: 'matched', runner_payout: 180 }),
    pickup_contact_name: 'Store Manager',
    pickup_contact_phone: '09170000001',
    dropoff_contact_name: 'Lola Cruz',
    dropoff_contact_phone: '09170000002',
    customer: { id: 'c1', full_name: 'Maria Santos', phone: '09170000003' },
    stops: [
      {
        id: 's1',
        sequence: 1,
        address: '12 Rizal St',
        lat: 14.5,
        lng: 121,
        contact_name: 'Kuya Ben',
        contact_phone: '09170000004',
      },
    ],
  }) as unknown as Booking;

describe('the offer pop-up', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('shows no phone number even when an older server still sends them', () => {
    const screen = render(
      <IncomingRequestModal
        booking={offerWithContacts()}
        onAccept={jest.fn()}
        onDecline={jest.fn()}
        timeoutSeconds={60}
      />,
    );
    for (const n of ['09170000001', '09170000002', '09170000003', '09170000004']) {
      expect(screen.queryByText(new RegExp(n))).toBeNull();
    }
  });
});

describe('the errand screen while the errand is only offered', () => {
  it('locks contacts on `matched` and blanks the customer phone', () => {
    expect(COCKPIT).toContain("const contactsLocked = booking?.status === 'matched';");
    expect(COCKPIT).toMatch(/const customerPhone = contactsLocked\s*\?\s*null/);
  });

  it('hides the Call buttons and says when details appear', () => {
    expect(COCKPIT).toContain("'Contact details show after you accept'");
    expect(COCKPIT).toMatch(/\{contactsLocked \? null : \(\s*<Pressable\s*onPress=\{handleCallCustomer\}/);
    expect(COCKPIT).toContain('contactsLocked={contactsLocked}');
    // A stop's number is dropped before it can reach the row's text or Call.
    expect(COCKPIT).toContain('const phone = contactsLocked ? null : stop.contact_phone ?? null;');
  });
});
