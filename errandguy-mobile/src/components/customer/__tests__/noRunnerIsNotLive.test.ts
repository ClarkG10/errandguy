import { isRenderableActiveBooking } from '../ActiveBookingCard';
import { makeBooking } from '../../../__mocks__/factories';

/**
 * A "no runner" errand is over: tracking shows "No runners available" and the
 * staff panel counts it as cancelled. The server still lists it as active (it
 * can be searched again until its matching window closes), and Home showed it
 * as a "Finding a runner" card under "2 ACTIVE" while Profile said "Errand in
 * progress" and refused the switch to runner mode.
 */
describe('isRenderableActiveBooking', () => {
  it('leaves out an errand no runner took', () => {
    expect(isRenderableActiveBooking(makeBooking({ status: 'no_runner' }))).toBe(false);
  });

  it.each(['pending', 'matched', 'accepted', 'in_transit', 'delivered'] as const)(
    'keeps a live %s errand',
    (status) => {
      expect(isRenderableActiveBooking(makeBooking({ status }))).toBe(true);
    },
  );

  it('still refuses a booking with no usable status', () => {
    expect(isRenderableActiveBooking(makeBooking({ status: undefined as never }))).toBe(false);
    expect(isRenderableActiveBooking(null)).toBe(false);
  });
});
