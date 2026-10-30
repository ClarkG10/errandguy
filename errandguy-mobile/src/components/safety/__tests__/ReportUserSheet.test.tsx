import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  ReportUserSheet,
  REPORT_USER_CATEGORY,
  buildReportUserTicket,
} from '../ReportUserSheet';
import { supportService } from '../../../services/support.service';

/**
 * "Report this person": either side of an errand files a 'report_user' ticket
 * that names the errand (booking_id) and the person (reported_user_id).
 */
jest.mock('../../../services/support.service', () => ({
  supportService: { createTicket: jest.fn() },
}));

const createTicket = supportService.createTicket as jest.Mock;

const renderSheet = (onSubmitted = jest.fn()) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ReportUserSheet
        visible
        onClose={jest.fn()}
        bookingId="bk-1"
        bookingNumber="EG-1234"
        reportedUserId="user-runner-9"
        reportedName="Jun"
        counterpart="runner"
        onSubmitted={onSubmitted}
      />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  createTicket.mockReset();
  createTicket.mockResolvedValue({ data: { data: { id: 'tk-77' } } });
});

describe('buildReportUserTicket', () => {
  it('names the errand, the person and the report_user category', () => {
    expect(
      buildReportUserTicket({
        bookingId: 'bk-1',
        bookingNumber: 'EG-1234',
        reportedUserId: 'user-customer-3',
        counterpart: 'customer',
        reason: 'harassment',
        note: '  Kept calling after delivery.  ',
      }),
    ).toEqual({
      subject: 'Report about the customer — EG-1234',
      category: 'report_user',
      message: 'Reason: Rude, abusive or harassing\n\nKept calling after delivery.\n\nErrand: EG-1234',
      booking_id: 'bk-1',
      reported_user_id: 'user-customer-3',
    });
    expect(REPORT_USER_CATEGORY).toBe('report_user');
  });

  it('omits an empty note', () => {
    const t = buildReportUserTicket({
      bookingId: 'bk-1',
      reportedUserId: 'u',
      counterpart: 'runner',
      reason: 'unsafe',
      note: '   ',
    });
    expect(t.message).toBe('Reason: Made me feel unsafe\n\nErrand: bk-1');
  });
});

describe('ReportUserSheet', () => {
  it('needs a reason before it sends anything', () => {
    const screen = renderSheet();
    expect(screen.getByText('Pick what happened to continue.')).toBeTruthy();
    fireEvent.press(screen.getByText('Send report'));
    expect(createTicket).not.toHaveBeenCalled();
  });

  it('files the report for this errand and person, then hands back the ticket', async () => {
    const onSubmitted = jest.fn();
    const screen = renderSheet(onSubmitted);
    expect(screen.getByText('Report Jun')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Made me feel unsafe'));
    fireEvent.changeText(screen.getByLabelText('Report details'), 'Drove recklessly');
    fireEvent.press(screen.getByText('Send report'));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith('tk-77'));
    expect(createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'report_user',
        booking_id: 'bk-1',
        reported_user_id: 'user-runner-9',
        message: expect.stringContaining('Drove recklessly'),
      }),
    );
  });

  it('keeps the sheet open (no hand-back) when filing fails', async () => {
    createTicket.mockRejectedValue({ status: 500, kind: 'server' });
    const onSubmitted = jest.fn();
    const screen = renderSheet(onSubmitted);
    fireEvent.press(screen.getByLabelText('Something else'));
    fireEvent.press(screen.getByText('Send report'));
    await waitFor(() => expect(createTicket).toHaveBeenCalled());
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(screen.getByText('Send report')).toBeTruthy();
  });
});
