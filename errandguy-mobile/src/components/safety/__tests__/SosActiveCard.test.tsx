import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import {
  SosActiveCard,
  SosResolvedNotice,
  sosAlertedText,
  sosContactsHeading,
  sosResolvedText,
} from '../SosActiveCard';
import type { SosActiveRecord } from '../../../services/sosActive';

/**
 * The live SOS card is the one place the app tells someone in danger what
 * happened. It must repeat the server, never embellish it, and always put a
 * voice call to 911 one tap away.
 */
const record = (over: Partial<SosActiveRecord> = {}): SosActiveRecord => ({
  bookingId: 'bk-1',
  role: 'customer',
  acknowledgedAt: Date.now(),
  alertedLine: null,
  contacts: [],
  resolvedAt: null,
  resolvedBy: null,
  ...over,
});

const CONTACTS = [{ id: 'c1', name: 'Ana Cruz', phone: '0917 111 2222' }];

let openURL: jest.SpyInstance;
beforeEach(() => {
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
});
afterEach(() => openURL.mockRestore());

describe('what the card claims', () => {
  it('repeats the server’s own sentence about who was alerted', () => {
    expect(
      sosAlertedText(record({ alertedLine: 'ErrandGuy staff were alerted by email and phone.' })),
    ).toBe('ErrandGuy staff were alerted by email and phone.');
  });

  it('without one, claims support only — plus contacts the server CONFIRMED', () => {
    expect(sosAlertedText(record())).toBe('Alerted ErrandGuy support.');
    expect(sosAlertedText(record({ contacts: ['c1', 'c2'] }))).toBe(
      'Alerted ErrandGuy support and 2 trusted contacts.',
    );
  });

  it('never implies contacts were messaged unless the server said so', () => {
    expect(sosContactsHeading(record())).toBe('We haven’t messaged these people — tap to call:');
    expect(sosContactsHeading(record({ alertedLine: 'Staff alerted.' }))).toBe(
      'Your trusted contacts — tap to call:',
    );
    expect(sosContactsHeading(record({ contacts: ['c1'] }))).toBe('Call them too — tap a name:');
  });

  it('says WHEN staff closed it, and stays vague when only the server state says so', () => {
    const at = new Date(2026, 9, 31, 15, 42).getTime();
    expect(sosResolvedText(record({ resolvedAt: at, resolvedBy: 'staff' }))).toBe(
      'ErrandGuy safety closed your alert at 3:42 PM.',
    );
    expect(sosResolvedText(record({ resolvedAt: at, resolvedBy: 'server' }))).toBe(
      'Your SOS alert has been closed.',
    );
  });
});

describe('SosActiveCard', () => {
  const renderCard = (over: Partial<SosActiveRecord> = {}, contacts = CONTACTS) =>
    render(
      <SosActiveCard
        record={record(over)}
        elapsedLabel="1m 5s"
        contacts={contacts}
        onStandDown={jest.fn()}
        standingDown={false}
        standDownResetKey={0}
      />,
    );

  it('puts a voice call to 911 one tap away', () => {
    const screen = renderCard();
    fireEvent.press(screen.getByLabelText('Call 911'));
    expect(openURL).toHaveBeenCalledWith('tel:911');
  });

  it('dials a trusted contact with one tap', () => {
    const screen = renderCard();
    fireEvent.press(screen.getByLabelText('Call Ana Cruz at 0917 111 2222'));
    expect(openURL).toHaveBeenCalledWith('tel:09171112222');
  });

  it('shows the elapsed time, the honest alerted line and the stand-down', () => {
    const screen = renderCard();
    expect(screen.getByText('SOS active')).toBeTruthy();
    expect(screen.getByText('1m 5s')).toBeTruthy();
    expect(screen.getByText(/Alerted ErrandGuy support\./)).toBeTruthy();
    expect(screen.getByText('We haven’t messaged these people — tap to call:')).toBeTruthy();
    expect(screen.getByText('I’m safe — cancel alert')).toBeTruthy();
  });

  it('keeps 911 even with no trusted contacts saved', () => {
    const screen = renderCard({}, []);
    expect(screen.getByLabelText('Call 911')).toBeTruthy();
    expect(screen.queryByText(/tap to call/)).toBeNull();
  });
});

describe('SosResolvedNotice', () => {
  it('says the alert is closed, offers 911, and can be dismissed', () => {
    const onDismiss = jest.fn();
    const screen = render(
      <SosResolvedNotice
        record={record({ resolvedAt: Date.now(), resolvedBy: 'staff' })}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText('SOS closed')).toBeTruthy();
    expect(screen.getByText(/ErrandGuy safety closed your alert at/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Call 911'));
    expect(openURL).toHaveBeenCalledWith('tel:911');
    fireEvent.press(screen.getByLabelText('Dismiss this notice'));
    expect(onDismiss).toHaveBeenCalled();
  });
});
