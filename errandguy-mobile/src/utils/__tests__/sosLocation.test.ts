/**
 * The phone's GPS for an SOS: never prompts, never holds the alarm past its
 * budget, falls back to the last known fix, and shapes the request body the
 * server reads (lat, lng, accuracy).
 */
import * as Location from 'expo-location';
import { locateForSos, readSosCoords, sosBody } from '../sosLocation';

const loc = Location as unknown as Record<string, jest.Mock>;

const fix = (lat: number, lng: number, accuracy: number | null = 8) => ({
  coords: { latitude: lat, longitude: lng, accuracy, heading: null, speed: null },
});

beforeEach(() => {
  loc.getForegroundPermissionsAsync = jest.fn(() => Promise.resolve({ status: 'granted' }));
  loc.getLastKnownPositionAsync = jest.fn(() => Promise.resolve(fix(14.5, 121.0, 40)));
  loc.getCurrentPositionAsync = jest.fn(() => Promise.resolve(fix(14.55, 121.02, 6.4)));
  loc.requestForegroundPermissionsAsync = jest.fn(() => Promise.resolve({ status: 'granted' }));
});

describe('locateForSos', () => {
  it('returns a fresh fix, accuracy rounded to whole metres', async () => {
    await expect(locateForSos()).resolves.toEqual({ lat: 14.55, lng: 121.02, accuracy: 6 });
  });

  it('never asks for permission mid-emergency — no grant, no coordinates', async () => {
    loc.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await expect(locateForSos()).resolves.toBeNull();
    expect(loc.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('falls back to the last known position when a fresh fix doesn’t come in time', async () => {
    loc.getCurrentPositionAsync.mockImplementation(() => new Promise(() => {}));
    await expect(locateForSos(800)).resolves.toEqual({ lat: 14.5, lng: 121.0, accuracy: 40 });
  });

  it('gives up within its budget rather than holding the alarm', async () => {
    loc.getForegroundPermissionsAsync.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    await expect(locateForSos(200)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('rejects nonsense coordinates', async () => {
    loc.getCurrentPositionAsync.mockResolvedValue(fix(NaN, 121));
    loc.getLastKnownPositionAsync.mockResolvedValue(null);
    await expect(locateForSos()).resolves.toBeNull();
  });
});

describe('sosBody / readSosCoords', () => {
  it('sends lat, lng and accuracy — or no body at all without a fix', () => {
    expect(sosBody({ lat: 1, lng: 2, accuracy: 9 })).toEqual({ lat: 1, lng: 2, accuracy: 9 });
    expect(sosBody({ lat: 1, lng: 2, accuracy: null })).toEqual({ lat: 1, lng: 2 });
    expect(sosBody(null)).toBeUndefined();
  });

  it('reads persisted coordinates back, dropping anything unusable', () => {
    expect(readSosCoords({ lat: 14.5, lng: 121, accuracy: 3 })).toEqual({
      lat: 14.5,
      lng: 121,
      accuracy: 3,
    });
    expect(readSosCoords({ lat: 200, lng: 121 })).toBeNull();
    expect(readSosCoords(undefined)).toBeNull();
    expect(readSosCoords('nope')).toBeNull();
  });
});
