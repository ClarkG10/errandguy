jest.mock('../api', () => ({
  __esModule: true,
  default: { post: jest.fn(), put: jest.fn() },
}));
jest.mock('../deviceIdentity', () => ({
  deviceIdentity: jest.fn(async () => ({ device_id: 'dev-123', device_name: 'Google Pixel 7 · Android 14' })),
}));

import api from '../api';
import { authService } from '../auth.service';

const post = api.post as jest.Mock;
const put = api.put as jest.Mock;

beforeEach(() => {
  post.mockReset();
  put.mockReset();
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
});

const body = (call = 0) => post.mock.calls[call][1];

describe('sign-in carries this phone, and phones go out as +639…', () => {
  it('login by phone normalises the number and sends device_id / device_name', async () => {
    await authService.login({ phone: '0917 123 4567', password: 'pw' });
    expect(post).toHaveBeenCalledWith('/auth/login', {
      phone: '+639171234567',
      password: 'pw',
      device_id: 'dev-123',
      device_name: 'Google Pixel 7 · Android 14',
    });
  });

  it('login by email is untouched apart from the device fields', async () => {
    await authService.login({ email: 'ana@example.com', password: 'pw' });
    expect(body()).toEqual({
      email: 'ana@example.com',
      password: 'pw',
      device_id: 'dev-123',
      device_name: 'Google Pixel 7 · Android 14',
    });
  });

  it('signs in with ONE request — a retry would double-count against the lockout', async () => {
    post.mockRejectedValueOnce({ status: 422, errors: { credentials: ['The provided credentials are incorrect.'] } });
    await expect(authService.login({ phone: '09171234567', password: 'wrong' })).rejects.toMatchObject({
      status: 422,
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('OTP sign-in sends the device fields; send-otp normalises the phone', async () => {
    await authService.verifyOTP({ email: 'ana@example.com', code: '123456' });
    expect(body()).toMatchObject({ device_id: 'dev-123', code: '123456' });
    await authService.sendOTP({ phone: '9171234567' });
    expect(body(1)).toEqual({ phone: '+639171234567' });
  });

  it('register normalises the phone', async () => {
    await authService.register({ full_name: 'Ana', phone: '09171234567', email: 'a@b.co', password: 'pw' });
    expect(body()).toMatchObject({ phone: '+639171234567', device_id: 'dev-123' });
  });
});

describe('sign-out', () => {
  it('sends the Expo push token as device_token, bounded so it cannot hang', async () => {
    await authService.logout('ExponentPushToken[abc]');
    expect(post).toHaveBeenCalledWith(
      '/auth/logout',
      { device_token: 'ExponentPushToken[abc]' },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(post.mock.calls[0][2].timeout).toBeLessThanOrEqual(10_000);
  });

  it('sends no device_token when there is none', async () => {
    await authService.logout(null);
    expect(body()).toEqual({});
  });

  it('sign out of all devices hits /auth/logout-all', async () => {
    await authService.logoutAll('ExponentPushToken[abc]');
    expect(post).toHaveBeenCalledWith('/auth/logout-all', { device_token: 'ExponentPushToken[abc]' });
  });
});

describe('passwords', () => {
  it('forgot-password asks for a code for the trimmed email', async () => {
    await authService.forgotPassword('  ana@example.com ');
    expect(post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'ana@example.com' });
  });

  it('reset-password sends the 6-digit CODE (not a link token) and the new password twice', async () => {
    await authService.resetPassword({
      email: 'ana@example.com',
      code: '123456',
      password: 'Errand#2026',
      password_confirmation: 'Errand#2026',
    });
    expect(post).toHaveBeenCalledWith('/auth/reset-password', {
      email: 'ana@example.com',
      code: '123456',
      password: 'Errand#2026',
      password_confirmation: 'Errand#2026',
    });
    expect(body()).not.toHaveProperty('token');
  });

  it('change password is PUT /user/password, keeping this phone\'s push via device_token', async () => {
    const data = { current_password: 'old', password: 'Errand#2026', password_confirmation: 'Errand#2026' };
    await authService.changePassword({ ...data, device_token: 'ExponentPushToken[abc]' });
    expect(put).toHaveBeenCalledWith('/user/password', { ...data, device_token: 'ExponentPushToken[abc]' });
    await authService.changePassword({ ...data, device_token: null });
    expect(put.mock.calls[1][1]).toEqual(data);
  });
});

describe('email verification', () => {
  it('uses the signed-in endpoints', async () => {
    await authService.sendEmailVerification('ana@example.com');
    await authService.verifyEmail('ana@example.com', '654321');
    expect(post.mock.calls[0][0]).toBe('/user/email/send-code');
    expect(post.mock.calls[1]).toEqual(['/user/email/verify', { code: '654321' }]);
  });

  it('falls back to the public OTP endpoints on a server without them (404)', async () => {
    post.mockRejectedValueOnce({ status: 404 }).mockResolvedValueOnce({ data: {} });
    await authService.sendEmailVerification('ana@example.com');
    expect(post.mock.calls[1]).toEqual(['/auth/send-otp', { email: 'ana@example.com' }]);

    post.mockRejectedValueOnce({ status: 404 }).mockResolvedValueOnce({ data: {} });
    await authService.verifyEmail('ana@example.com', '654321');
    expect(post.mock.calls[3]).toEqual(['/auth/verify-otp', { email: 'ana@example.com', code: '654321' }]);
  });

  it('a wrong code is NOT retried against the fallback', async () => {
    post.mockRejectedValueOnce({ status: 422, message: 'Invalid code' });
    await expect(authService.verifyEmail('ana@example.com', '000000')).rejects.toMatchObject({ status: 422 });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
