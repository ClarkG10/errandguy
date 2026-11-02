import { authService } from './auth.service';
import { currentPushToken, unregisterPushLocally } from './pushToken';
import { useAuthStore } from '../stores/authStore';
import { stopRunnerActivity } from '../utils/runnerSession';

/**
 * Every way a session ends, in one place — so each of them also lets go of
 * this phone's push registration, which a bare `authStore.logout()` never did.
 */

/**
 * The server has already ended the session (a revoked token, a deleted
 * account, a password reset): clean up this phone only.
 */
export async function endLocalSession(): Promise<void> {
  // GPS + heartbeat off before anything awaits: each ping from here on would
  // carry a dead token.
  stopRunnerActivity();
  await unregisterPushLocally();
  await useAuthStore.getState().logout();
}

/**
 * Sign THIS phone out. The server call carries the push token as
 * `device_token` so this account stops being pushed to the phone; it is
 * best-effort — offline or a server error still signs the person out here
 * (the token simply expires server-side).
 */
export async function signOut(): Promise<void> {
  // Before the server call: the moment it revokes the token, a heartbeat
  // still in the air comes back 401 and tears the session down a second time.
  stopRunnerActivity();
  try {
    await authService.logout(currentPushToken());
  } catch {
    // Never trap someone in an account because the network is down.
  }
  await endLocalSession();
}

/**
 * Sign out every device on the account. Unlike `signOut`, a failed server call
 * THROWS and leaves this phone signed in: the other devices are still signed
 * in, and pretending otherwise is the one outcome this action exists to avoid.
 */
export async function signOutEverywhere(): Promise<void> {
  await authService.logoutAll(currentPushToken());
  await endLocalSession();
}
