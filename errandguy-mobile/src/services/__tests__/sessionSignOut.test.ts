jest.mock('../auth.service', () => ({
  authService: { logout: jest.fn(), logoutAll: jest.fn() },
}));
jest.mock('../pushToken', () => ({
  currentPushToken: jest.fn(() => 'ExponentPushToken[abc]'),
  unregisterPushLocally: jest.fn(async () => {}),
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import { authService } from '../auth.service';
import { unregisterPushLocally } from '../pushToken';
import { endLocalSession, signOut, signOutEverywhere } from '../session.service';
import { useAuthStore } from '../../stores/authStore';

const logout = authService.logout as jest.Mock;
const logoutAll = authService.logoutAll as jest.Mock;
const unregister = unregisterPushLocally as jest.Mock;
let storeLogout: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  storeLogout = jest.spyOn(useAuthStore.getState(), 'logout').mockResolvedValue(undefined);
  useAuthStore.setState({ logout: storeLogout as any });
});

describe('signOut (this phone)', () => {
  it('tells the server with the push token, THEN lets go of push and the session locally', async () => {
    const order: string[] = [];
    logout.mockImplementation(async () => order.push('server'));
    unregister.mockImplementation(async () => order.push('push'));
    storeLogout.mockImplementation(async () => order.push('store'));

    await signOut();

    expect(logout).toHaveBeenCalledWith('ExponentPushToken[abc]');
    // The server call needs the token the store logout deletes, so it goes first.
    expect(order).toEqual(['server', 'push', 'store']);
  });

  it('still signs out here when the server cannot be reached', async () => {
    logout.mockRejectedValue({ status: 0 });
    await expect(signOut()).resolves.toBeUndefined();
    expect(unregister).toHaveBeenCalled();
    expect(storeLogout).toHaveBeenCalled();
  });
});

describe('signOutEverywhere', () => {
  it('signs out locally once the server confirms', async () => {
    logoutAll.mockResolvedValue({});
    await signOutEverywhere();
    expect(logoutAll).toHaveBeenCalledWith('ExponentPushToken[abc]');
    expect(storeLogout).toHaveBeenCalled();
  });

  it('a failure throws and leaves this phone signed in — the other devices still are', async () => {
    logoutAll.mockRejectedValue({ status: 0 });
    await expect(signOutEverywhere()).rejects.toEqual({ status: 0 });
    expect(storeLogout).not.toHaveBeenCalled();
    expect(unregister).not.toHaveBeenCalled();
  });
});

it('endLocalSession lets go of push too', async () => {
  await endLocalSession();
  expect(unregister).toHaveBeenCalled();
  expect(storeLogout).toHaveBeenCalled();
});

describe('architecture: every sign-out path goes through session.service', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

  it('no screen calls the store logout directly (it skips the server and leaves push live)', () => {
    for (const rel of [
      'app/_layout.tsx',
      'app/(runner)/(tabs)/profile.tsx',
      'app/(customer)/(tabs)/profile.tsx',
      'app/(runner)/onboarding.tsx',
      'components/settings/AccountSecurity.tsx',
    ]) {
      expect(read(rel)).not.toMatch(/useAuthStore\(\(s\) => s\.logout\)/);
    }
    expect(read('hooks/useAuth.ts')).toMatch(/signOut\(\)/);
    expect(read('app/(runner)/(tabs)/profile.tsx')).toMatch(/await signOut\(\)/);
    expect(read('app/_layout.tsx')).toMatch(/await endLocalSession\(\)/);
  });

  it('push re-syncs for the next account after a sign-out', () => {
    const hook = read('hooks/useNotifications.ts');
    expect(hook).toMatch(/rememberPushToken\(tokenData\.data\)/);
    // When registration is disabled (signed out) the once-per-session guard resets.
    expect(hook).toMatch(/if \(!enabled\) \{[\s\S]*?tokenSynced\.current = false;/);
  });
});
