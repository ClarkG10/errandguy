import api from './api';
import { deviceIdentity } from './deviceIdentity';
import { phoneForApi } from '../utils/phone';

/**
 * Every account / session endpoint the app calls, in one place.
 *
 * Phone numbers are normalised to +639XXXXXXXXX here (utils/phone), so no
 * screen can send one in another shape. Sign-in calls carry this phone's
 * `device_id` / `device_name` (services/deviceIdentity) so the server keeps one
 * session per device.
 */

/**
 * Signed-in email verification (EmailVerificationController): email a code to
 * the account's current address, then check it.
 */
const EMAIL_VERIFICATION_SEND_PATH = '/user/email/send-code';
const EMAIL_VERIFICATION_VERIFY_PATH = '/user/email/verify';

/** Network calls a stuck sign-out must not wait the default 30s on. */
const SIGN_OUT_TIMEOUT_MS = 8_000;

const isNotFound = (err: unknown) => (err as { status?: number } | null)?.status === 404;

export const authService = {
  async register(data: {
    phone?: string;
    email?: string;
    password: string;
    full_name: string;
    // Terms/Privacy consent captured at sign-up (PRIV-2).
    terms_accepted?: boolean;
    privacy_policy_version?: string;
  }) {
    return api.post('/auth/register', {
      ...data,
      phone: phoneForApi(data.phone),
      ...(await deviceIdentity()),
    });
  },

  /**
   * One request, never a retry with another spelling of the phone: the server
   * normalises the number it receives and stores every account's as +639…
   * (NormalizesPhoneNumbers + the phone migration), and every extra attempt
   * would count against the 5-per-15-minutes sign-in lockout.
   */
  async login(data: { phone?: string; email?: string; password: string }) {
    return api.post('/auth/login', {
      ...data,
      ...(data.phone !== undefined ? { phone: phoneForApi(data.phone) } : null),
      ...(await deviceIdentity()),
    });
  },

  sendOTP(data: { phone?: string; email?: string }) {
    return api.post('/auth/send-otp', {
      ...data,
      ...(data.phone !== undefined ? { phone: phoneForApi(data.phone) } : null),
    });
  },

  async verifyOTP(data: { phone?: string; email?: string; code: string }) {
    return api.post('/auth/verify-otp', {
      ...data,
      ...(data.phone !== undefined ? { phone: phoneForApi(data.phone) } : null),
      ...(await deviceIdentity()),
    });
  },

  /**
   * Sign THIS phone out. `device_token` is the Expo push token, so the server
   * stops pushing this account's notifications to a phone nobody is signed in
   * on. Bounded: a sign-out must never hang on a dead network.
   */
  logout(deviceToken?: string | null) {
    return api.post(
      '/auth/logout',
      deviceToken ? { device_token: deviceToken } : {},
      { timeout: SIGN_OUT_TIMEOUT_MS },
    );
  },

  /** Sign out every device on this account, this one included. */
  logoutAll(deviceToken?: string | null) {
    return api.post('/auth/logout-all', deviceToken ? { device_token: deviceToken } : {});
  },

  /** Emails a 6-digit reset code when the account exists (always a generic success). */
  forgotPassword(email: string) {
    return api.post('/auth/forgot-password', { email: email.trim() });
  },

  /** Sets a new password with the emailed code; the server signs the account out everywhere. */
  resetPassword(data: {
    email: string;
    code: string;
    password: string;
    password_confirmation: string;
  }) {
    return api.post('/auth/reset-password', { ...data, email: data.email.trim() });
  },

  /**
   * Change the password while signed in; other devices are signed out.
   * `device_token` (this phone's Expo push token) keeps THIS phone's push
   * registration when the server drops the others'.
   */
  changePassword(data: {
    current_password: string;
    password: string;
    password_confirmation: string;
    device_token?: string | null;
  }) {
    const { device_token, ...rest } = data;
    return api.put('/user/password', device_token ? { ...rest, device_token } : rest);
  },

  /**
   * Email a 6-digit code to the signed-in account's email. Falls back to the
   * public OTP endpoint on a server that predates the signed-in route (404) —
   * that endpoint verifies an email the same way.
   */
  async sendEmailVerification(email: string) {
    try {
      return await api.post(EMAIL_VERIFICATION_SEND_PATH, {});
    } catch (err) {
      if (!isNotFound(err)) throw err;
      return api.post('/auth/send-otp', { email });
    }
  },

  /** Check the emailed code; on success the response carries the updated profile. */
  async verifyEmail(email: string, code: string) {
    try {
      return await api.post(EMAIL_VERIFICATION_VERIFY_PATH, { code });
    } catch (err) {
      if (!isNotFound(err)) throw err;
      return api.post('/auth/verify-otp', { email, code });
    }
  },
};
