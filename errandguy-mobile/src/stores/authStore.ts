import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureStorage } from '../utils/storage';
import { clearAccountScopedState } from '../utils/clearAccountScopedState';
import type { User, UserRole } from '../types';

// Id of the account whose data is currently resident on this device. Compared
// on every sign-in: a DIFFERENT id triggers a purge of the previous user's
// cached/persisted state so it can't bleed into the new account.
const LAST_ACCOUNT_KEY = '@last_account_id';

/**
 * On sign-in, purge account-scoped state iff the incoming user differs from the
 * one already resident on this device. The first sign-in on a device (no stored
 * id) never purges. Best-effort — a bookkeeping failure must never block login.
 */
async function reconcileAccount(userId: string): Promise<void> {
  try {
    const prev = await AsyncStorage.getItem(LAST_ACCOUNT_KEY);
    if (prev && prev !== userId) {
      await clearAccountScopedState();
    }
    if (prev !== userId) {
      await AsyncStorage.setItem(LAST_ACCOUNT_KEY, userId);
    }
  } catch {
    // Bookkeeping only — must never break login.
  }
}

/**
 * Persisted "remember me" profile. `identifier` is what pre-fills the
 * login form; `firstName` / `avatarUrl` are NON-SECRET display fields
 * used only to personalize the login screen ("Welcome back, Juan").
 */
export interface RememberedCredentials {
  identifier: string;
  firstName?: string;
  avatarUrl?: string | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  role: UserRole | null;
  onboardingSeen: boolean;
  runnerOnboardingSkipped: boolean;
  rememberedCredentials: RememberedCredentials | null;
  /**
   * User has opted into biometric (Face ID / Touch ID / fingerprint)
   * unlock. Persisted in the device keychain via secureStorage.
   */
  biometricEnabled: boolean;
  /**
   * A persisted session token exists but auth is being WITHHELD until the
   * user passes a biometric check (set on cold start when
   * `biometricEnabled` is on and a token is present). The token stays in
   * secureStorage — so API calls remain authenticated — but `token` /
   * `isAuthenticated` in state stay empty so the app routes to the login
   * screen and shows the "Unlock with Face ID" affordance.
   */
  biometricLockPending: boolean;

  setUser: (user: User | null) => void;
  setToken: (token: string | null) => Promise<void>;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  updateProfile: (data: Partial<User>) => void;
  setRunnerOnboardingSkipped: (skipped: boolean) => Promise<void>;
  setRememberedCredentials: (creds: RememberedCredentials | null) => Promise<void>;
  /**
   * Persist whether the CURRENT session should survive a full app restart.
   * Driven by the "Remember me" toggle at login: when `false`, the login is
   * session-only — the token is kept for this run (so the user stays signed
   * in while the app is open / backgrounded) but `loadFromStorage` clears it
   * on the next cold start, so the app is fully closed = signed out.
   */
  setSessionPersistent: (persistent: boolean) => Promise<void>;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  /**
   * Finalize a biometric unlock: the caller has already validated the
   * persisted token via userService.getProfile and passes the fresh
   * user. Restores `token` / `isAuthenticated` from secureStorage and
   * clears the pending lock so the router lets the user in.
   */
  completeBiometricUnlock: (user: User) => Promise<void>;
  /**
   * "Not you?" from the biometric-locked login screen: forget the
   * remembered profile is handled separately, but this drops the
   * persisted token and disables biometric so the next account can't be
   * unlocked with the previous user's credentials.
   */
  clearBiometricSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  role: null,
  onboardingSeen: false,
  runnerOnboardingSkipped: false,
  rememberedCredentials: null,
  biometricEnabled: false,
  biometricLockPending: false,

  setUser: (user) => {
    set({
      user,
      role: user?.role ?? null,
      isAuthenticated: !!user,
    });
    // A different account signing in on this device purges the prior user's
    // resident cache / draft / payment state (fire-and-forget; never blocks
    // login). Same account (resume / profile refresh) is a no-op.
    if (user?.id != null) {
      void reconcileAccount(String(user.id));
    }
  },

  setToken: async (token) => {
    if (token) {
      await secureStorage.set('auth_token', token);
    } else {
      await secureStorage.remove('auth_token');
    }
    set({ token });
  },

  setRunnerOnboardingSkipped: async (skipped) => {
    if (skipped) {
      await AsyncStorage.setItem('@runner_onboarding_skipped', 'true');
    } else {
      await AsyncStorage.removeItem('@runner_onboarding_skipped');
    }
    set({ runnerOnboardingSkipped: skipped });
  },

  setRememberedCredentials: async (creds) => {
    // SECURITY: We deliberately persist ONLY the identifier (phone/email)
    // plus non-secret display fields (first name, avatar URL) — never the
    // password. Storing the password — even in the device keychain —
    // broadens the blast radius of a compromised unlock and contradicts
    // the principle of session-bound credentials. The auth token already
    // provides "stay signed in" without this risk.
    if (creds) {
      await secureStorage.set(
        'remembered_credentials',
        JSON.stringify({
          identifier: creds.identifier,
          firstName: creds.firstName,
          avatarUrl: creds.avatarUrl,
        }),
      );
    } else {
      await secureStorage.remove('remembered_credentials');
    }
    set({ rememberedCredentials: creds });
  },

  setSessionPersistent: async (persistent) => {
    await secureStorage.set('session_persistent', persistent ? 'true' : 'false');
  },

  setBiometricEnabled: async (enabled) => {
    if (enabled) {
      await secureStorage.set('biometric_enabled', 'true');
    } else {
      await secureStorage.remove('biometric_enabled');
    }
    // Disabling always clears any pending lock so the next cold start
    // doesn't strand the user behind an unlock they turned off.
    set({ biometricEnabled: enabled, biometricLockPending: enabled ? get().biometricLockPending : false });
  },

  completeBiometricUnlock: async (user) => {
    // The token is already in secureStorage (it was withheld from state,
    // not removed) — read it back so state and keychain agree again.
    const token = await secureStorage.get('auth_token');
    set({
      user,
      role: user?.role ?? null,
      token,
      isAuthenticated: !!token && !!user,
      biometricLockPending: false,
    });
  },

  clearBiometricSession: async () => {
    await Promise.all([
      secureStorage.remove('auth_token'),
      secureStorage.remove('biometric_enabled'),
      secureStorage.remove('session_persistent'),
    ]);
    set({
      token: null,
      isAuthenticated: false,
      biometricEnabled: false,
      biometricLockPending: false,
    });
  },

  logout: async () => {
    await secureStorage.remove('auth_token');
    // Biometric unlock is bound to the signed-out session — never let it
    // carry over to whoever signs in next on this device.
    await secureStorage.remove('biometric_enabled');
    await secureStorage.remove('session_persistent');
    await AsyncStorage.removeItem('@runner_onboarding_skipped');
    // Privacy: don't leak the previous user's recent destinations,
    // cached profile/wallet data, or in-memory request responses to
    // whoever signs in next on the same device.
    // Clears cached responses + recent addresses AND the per-user booking /
    // payment stores that used to survive a sign-out on this device.
    await clearAccountScopedState();
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      role: null,
      biometricEnabled: false,
      biometricLockPending: false,
    });
  },

  loadFromStorage: async () => {
    set({ isLoading: true });
    const [rawToken, onboardingSeen, runnerSkipped, rememberedRaw, biometricRaw, sessionRaw] = await Promise.all([
      secureStorage.get('auth_token'),
      AsyncStorage.getItem('@onboarding_seen'),
      AsyncStorage.getItem('@runner_onboarding_skipped'),
      secureStorage.get('remembered_credentials'),
      secureStorage.get('biometric_enabled'),
      secureStorage.get('session_persistent'),
    ]);

    // "Remember me" gate. `session_persistent === 'false'` means the last
    // login was session-only, so a fresh cold start (the app was fully
    // closed) must sign the user out. An ABSENT flag defaults to persistent
    // so pre-existing installs / tokens saved before this shipped aren't
    // logged out unexpectedly.
    let token = rawToken;
    if (token && sessionRaw === 'false') {
      await secureStorage.remove('auth_token');
      await secureStorage.remove('session_persistent');
      token = null;
    }
    let rememberedCredentials: RememberedCredentials | null = null;
    if (rememberedRaw) {
      try {
        const parsed = JSON.parse(rememberedRaw);
        // Backwards compat: silently drop any legacy stored password.
        if (parsed?.identifier) {
          rememberedCredentials = {
            identifier: String(parsed.identifier),
            firstName: parsed.firstName ? String(parsed.firstName) : undefined,
            avatarUrl: parsed.avatarUrl ? String(parsed.avatarUrl) : undefined,
          };
        }
      } catch {}
    }
    // Biometric gate: when the user has opted into Face ID / fingerprint
    // unlock AND a session token is persisted, WITHHOLD authentication
    // from state (token stays in secureStorage so API calls still carry
    // it) until the login screen passes a biometric check. This turns the
    // normal "auto-login" cold start into a locked one. If the token was
    // cleared (e.g. a 401 wiped it), there's nothing to replay: lockPending
    // is false, the unlock button is hidden, and password login applies.
    const biometricEnabled = biometricRaw === 'true';
    const biometricLockPending = biometricEnabled && !!token;
    set({
      token: biometricLockPending ? null : token,
      isAuthenticated: biometricLockPending ? false : !!token,
      onboardingSeen: onboardingSeen === 'true',
      runnerOnboardingSkipped: runnerSkipped === 'true',
      rememberedCredentials,
      biometricEnabled,
      biometricLockPending,
      isLoading: false,
    });
  },

  updateProfile: (data) => {
    const currentUser = get().user;
    if (currentUser) {
      set({ user: { ...currentUser, ...data } });
    }
  },
}));
