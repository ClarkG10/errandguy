jest.mock('../api', () => ({
  __esModule: true,
  default: { post: jest.fn(), put: jest.fn() },
}));
jest.mock('../../hooks/useQuery', () => ({ invalidateQuery: jest.fn() }));
jest.mock('../deviceIdentity', () => ({
  deviceIdentity: jest.fn(async () => ({ device_id: 'dev-123', device_name: 'Pixel 7 · Android 14' })),
}));

import api from '../api';
import { userService } from '../user.service';
import { bookingService } from '../booking.service';

const post = api.post as jest.Mock;
const put = api.put as jest.Mock;

beforeEach(() => {
  post.mockReset().mockResolvedValue({ data: {} });
  put.mockReset().mockResolvedValue({ data: {} });
});

describe('every mobile number reaches the server as +639XXXXXXXXX', () => {
  it('profile', async () => {
    await userService.updateProfile({ full_name: 'Ana', phone: '0917 123 4567' });
    expect(put).toHaveBeenCalledWith('/user/profile', { full_name: 'Ana', phone: '+639171234567' });
    // A save without a phone stays without one.
    await userService.updateProfile({ full_name: 'Ana' });
    expect(put.mock.calls[1][1]).toEqual({ full_name: 'Ana' });
  });

  it('trusted contacts', async () => {
    await userService.addTrustedContact({
      name: 'Ben',
      phone: '09181112222',
      relationship: 'Friend',
      priority: 1,
      is_active: true,
    } as any);
    expect(post.mock.calls[0][1].phone).toBe('+639181112222');
    await userService.updateTrustedContact('c1', { phone: '+63 918 111 2222' });
    expect(put.mock.calls[0][1].phone).toBe('+639181112222');
  });

  it('errand contacts, including extra stops', async () => {
    await bookingService.createBooking(
      {
        errand_type_id: 't',
        pickup_address: 'A',
        pickup_lat: 1,
        pickup_lng: 1,
        pickup_contact_phone: '09171234567',
        dropoff_contact_phone: '9181112222',
        stops: [
          { address: 'S', lat: 1, lng: 1, contact_phone: '0919 333 4444' },
          { address: 'T', lat: 1, lng: 1 },
        ],
        vehicle_type_rate: 'motorcycle',
        schedule_type: 'now',
      },
      { idempotencyKey: 'k' },
    );
    const sent = post.mock.calls[0][1];
    expect(sent.pickup_contact_phone).toBe('+639171234567');
    expect(sent.dropoff_contact_phone).toBe('+639181112222');
    expect(sent.stops[0].contact_phone).toBe('+639193334444');
    expect(sent.stops[1]).not.toHaveProperty('contact_phone');
    expect(post.mock.calls[0][2]).toEqual({ idempotencyKey: 'k' });
  });
});

describe('push registration names this phone', () => {
  it('sends the device_id and platform with the push token', async () => {
    await userService.updateFCMToken('ExponentPushToken[abc]');
    expect(put).toHaveBeenCalledWith('/user/fcm-token', {
      fcm_token: 'ExponentPushToken[abc]',
      platform: expect.any(String),
      device_id: 'dev-123',
    });
  });
});
