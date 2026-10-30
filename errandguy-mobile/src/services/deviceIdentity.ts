import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { secureStorage } from '../utils/storage';

/**
 * Which phone a sign-in belongs to.
 *
 * The server keeps one session per device (login / OTP sign-in take an
 * optional `device_id` and `device_name`), so signing in on a second phone no
 * longer ends the first, and "this phone" can be signed out — or listed —
 * on its own.
 *
 * `device_id` is a random id minted once per install and kept in the secure
 * store, so it survives sign-out (it identifies the phone, not the account)
 * and never carries a hardware identifier off the device. `device_name` is
 * only for people reading a list of their sessions ("Pixel 7 · Android 14").
 */

const DEVICE_ID_KEY = 'device_id';

export interface DeviceIdentity {
  device_id: string;
  device_name: string;
}

let pending: Promise<string> | null = null;

async function readOrMintDeviceId(): Promise<string> {
  try {
    const stored = await secureStorage.get(DEVICE_ID_KEY);
    if (stored) return stored;
  } catch {
    // Keychain unreadable — mint below; worst case this install gets a new id.
  }
  const fresh = Crypto.randomUUID();
  try {
    await secureStorage.set(DEVICE_ID_KEY, fresh);
  } catch {
    // Not persisted: the id still identifies this run's sign-in.
  }
  return fresh;
}

/** The install's stable id. Concurrent first calls share one mint. */
export function getDeviceId(): Promise<string> {
  if (!pending) {
    pending = readOrMintDeviceId().catch((err) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}

/**
 * "Google Pixel 7 · Android 14" — maker, model and OS. Deliberately NOT
 * `Device.deviceName`: on iOS that is the name the owner gave the phone
 * ("Juan's iPhone"), which is personal data the server has no use for.
 */
export function getDeviceName(): string {
  const modelName = (Device.modelName ?? '').trim();
  const maker = (Device.manufacturer ?? '').trim();
  const model =
    Platform.OS === 'android' && maker && modelName && !modelName.toLowerCase().includes(maker.toLowerCase())
      ? `${maker.charAt(0).toUpperCase()}${maker.slice(1)} ${modelName}`
      : modelName;
  const os = Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : Platform.OS;
  const osLabel = Device.osVersion ? `${os} ${Device.osVersion}` : os;
  return (model ? `${model} · ${osLabel}` : osLabel).slice(0, 100);
}

/**
 * The fields a sign-in request carries. Never throws: a sign-in must not fail
 * because the phone could not describe itself — the fields are optional.
 */
export async function deviceIdentity(): Promise<Partial<DeviceIdentity>> {
  try {
    return { device_id: await getDeviceId(), device_name: getDeviceName() };
  } catch {
    return {};
  }
}

/** Test seam: forget the memoised id. */
export function __resetDeviceIdentity(): void {
  pending = null;
}
