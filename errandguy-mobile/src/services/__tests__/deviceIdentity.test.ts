jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));
jest.mock('expo-device', () => ({
  modelName: 'Pixel 7',
  manufacturer: 'Google',
  osVersion: '14',
  deviceName: "Juan's phone",
}));

import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { secureStorage } from '../../utils/storage';
import { __resetDeviceIdentity, deviceIdentity, getDeviceName } from '../deviceIdentity';

beforeEach(() => {
  __resetDeviceIdentity();
  secureStorage.clearCache();
  (Crypto.randomUUID as jest.Mock).mockClear();
});

describe('device identity for per-device sign-in', () => {
  it('mints an id once and reuses it (it identifies the phone, not the account)', async () => {
    const set = jest.spyOn(secureStorage, 'set');
    const first = await deviceIdentity();
    const second = await deviceIdentity();
    expect(first.device_id).toBe('uuid-1');
    expect(second.device_id).toBe('uuid-1');
    expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('device_id', 'uuid-1');
    set.mockRestore();
  });

  it('reads an id an earlier launch stored', async () => {
    jest.spyOn(secureStorage, 'get').mockResolvedValueOnce('stored-id');
    expect((await deviceIdentity()).device_id).toBe('stored-id');
    expect(Crypto.randomUUID).not.toHaveBeenCalled();
  });

  it('names the phone by maker, model and OS — never the name its owner gave it', () => {
    const name = getDeviceName();
    expect(name).toContain('Pixel 7');
    expect(name).not.toContain('Juan');
    expect(name).toMatch(Platform.OS === 'ios' ? /iOS 14$/ : /Android 14$/);
  });

  it('is never a reason for sign-in to fail', async () => {
    jest.spyOn(secureStorage, 'get').mockRejectedValueOnce(new Error('keychain'));
    (Crypto.randomUUID as jest.Mock).mockImplementationOnce(() => {
      throw new Error('no crypto');
    });
    await expect(deviceIdentity()).resolves.toEqual({});
  });

  it('device_id survives sign-out (authStore.logout never removes it)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'stores', 'authStore.ts'), 'utf8');
    expect(src).not.toMatch(/remove\('device_id'\)/);
  });
});
