import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buildSystemMapsUrl,
  buildWazeAppUrl,
  buildWazeWebUrl,
  EXTERNAL_NAV_PREF_KEY,
  getPreferredNavApp,
  normalizeCoords,
  openExternalNav,
  setPreferredNavApp,
} from '../externalNav';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const getItem = AsyncStorage.getItem as unknown as jest.Mock;
const setItem = AsyncStorage.setItem as unknown as jest.Mock;

const MANILA = { lat: 14.5995, lng: 120.9842 };

describe('normalizeCoords', () => {
  it('accepts numeric and string pairs', () => {
    expect(normalizeCoords(14.5995, 120.9842)).toEqual(MANILA);
    expect(normalizeCoords('14.5995', '120.9842')).toEqual(MANILA);
  });

  it('rejects missing, non-finite and out-of-range values', () => {
    expect(normalizeCoords(null, 120)).toBeNull();
    expect(normalizeCoords(14, undefined)).toBeNull();
    expect(normalizeCoords('abc', '120')).toBeNull();
    expect(normalizeCoords(NaN, 120)).toBeNull();
    expect(normalizeCoords(91, 120)).toBeNull();
    expect(normalizeCoords(14, 181)).toBeNull();
  });
});

describe('url builders', () => {
  it('builds the Waze deep link with navigate=yes', () => {
    expect(buildWazeAppUrl(MANILA.lat, MANILA.lng)).toBe(
      'waze://?ll=14.5995,120.9842&navigate=yes',
    );
  });

  it('builds the Waze universal-link fallback', () => {
    expect(buildWazeWebUrl(MANILA.lat, MANILA.lng)).toBe(
      'https://waze.com/ul?ll=14.5995,120.9842&navigate=yes',
    );
  });

  it('keeps the existing per-OS system maps URLs', () => {
    expect(buildSystemMapsUrl(MANILA.lat, MANILA.lng, 'ios')).toBe(
      'http://maps.apple.com/?daddr=14.5995,120.9842&dirflg=d',
    );
    expect(buildSystemMapsUrl(MANILA.lat, MANILA.lng, 'android')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=14.5995,120.9842&travelmode=driving',
    );
  });

  it('trims float noise to 6dp', () => {
    expect(buildWazeAppUrl(14.599512345678, 120.9)).toBe(
      'waze://?ll=14.599512,120.9&navigate=yes',
    );
  });
});

describe('openExternalNav', () => {
  let canOpen: jest.SpyInstance;
  let open: jest.SpyInstance;

  beforeEach(() => {
    // RN's Linking methods are already jest.fn()s under jest-expo, so the spy
    // shares their call history — clear it explicitly per test.
    canOpen = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    canOpen.mockClear();
    open.mockClear();
  });

  afterEach(() => jest.restoreAllMocks());

  it('opens the Waze app when the scheme is supported', async () => {
    await expect(openExternalNav('waze', MANILA.lat, MANILA.lng)).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith('waze://?ll=14.5995,120.9842&navigate=yes');
  });

  it('falls back to the Waze universal link when the app is absent', async () => {
    canOpen.mockResolvedValue(false);
    await expect(openExternalNav('waze', MANILA.lat, MANILA.lng)).resolves.toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      'https://waze.com/ul?ll=14.5995,120.9842&navigate=yes',
    );
  });

  it('reports failure instead of throwing when nothing can open', async () => {
    open.mockRejectedValue(new Error('no activity'));
    await expect(openExternalNav('maps', MANILA.lat, MANILA.lng)).resolves.toBe(false);
  });
});

describe('remembered nav-app preference', () => {
  beforeEach(() => {
    getItem.mockReset();
    setItem.mockReset();
    setItem.mockResolvedValue(undefined);
  });

  it('reads back a stored choice', async () => {
    getItem.mockResolvedValue('waze');
    await expect(getPreferredNavApp()).resolves.toBe('waze');
    expect(getItem).toHaveBeenCalledWith(EXTERNAL_NAV_PREF_KEY);
  });

  it('treats an unset or unrecognised value as no preference', async () => {
    getItem.mockResolvedValue(null);
    await expect(getPreferredNavApp()).resolves.toBeNull();
    getItem.mockResolvedValue('gmaps-2019');
    await expect(getPreferredNavApp()).resolves.toBeNull();
  });

  it('never throws when storage is unavailable', async () => {
    getItem.mockRejectedValue(new Error('storage down'));
    await expect(getPreferredNavApp()).resolves.toBeNull();
    setItem.mockRejectedValue(new Error('storage down'));
    await expect(setPreferredNavApp('maps')).resolves.toBeUndefined();
  });

  it('persists the runner’s choice', async () => {
    await setPreferredNavApp('maps');
    expect(setItem).toHaveBeenCalledWith(EXTERNAL_NAV_PREF_KEY, 'maps');
  });
});
