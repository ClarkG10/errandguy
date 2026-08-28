/**
 * Recents now learn from CONFIRMED pins (book/details.tsx), not just search
 * picks, so `addRecent` has to reject the junk a map confirm can produce —
 * chiefly the bare "14.123456, 121.098765" label `reverse()` falls back to
 * when HERE can't resolve the point.
 *
 * (Lives under utils/__tests__ alongside the recipients test: both cover the
 * booking-form "remember what I used last time" surface.)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { geocodingService, isCoordinateLabel } from '../../services/geocoding.service';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('isCoordinateLabel', () => {
  it('flags the reverse-geocode coordinate fallback', () => {
    expect(isCoordinateLabel('14.123456, 121.098765')).toBe(true);
    expect(isCoordinateLabel('-14.1, -121.0')).toBe(true);
    expect(isCoordinateLabel(' 14.123456 ,121.098765 ')).toBe(true);
  });

  it('leaves real place names alone', () => {
    expect(isCoordinateLabel('SM Aura Premier, Taguig')).toBe(false);
    expect(isCoordinateLabel('7-Eleven, 123 Kalayaan Ave')).toBe(false);
    expect(isCoordinateLabel('')).toBe(false);
  });
});

describe('geocodingService.addRecent', () => {
  it('stores a confirmed pin and dedupes it on a re-confirm nearby', async () => {
    await geocodingService.addRecent({ place_name: 'Office', center: [121.05, 14.55] });
    await geocodingService.addRecent({ place_name: 'Home', center: [121.0, 14.6] });
    // ~4 m away — the same place as far as the quantized key is concerned.
    await geocodingService.addRecent({ place_name: 'Office Tower', center: [121.05001, 14.55001] });

    const recents = await geocodingService.getRecent();
    expect(recents.map((r) => r.place_name)).toEqual(['Office Tower', 'Home']);
  });

  it('refuses an unresolved coordinate label', async () => {
    await geocodingService.addRecent({
      place_name: '14.550000, 121.050000',
      center: [121.05, 14.55],
    });
    await expect(geocodingService.getRecent()).resolves.toEqual([]);
  });

  it('refuses malformed coordinates instead of poisoning the list', async () => {
    await geocodingService.addRecent({ place_name: 'Nowhere', center: [NaN, 14.55] });
    // @ts-expect-error — a persisted list from an older build could hold this
    await geocodingService.addRecent({ place_name: 'Nowhere', center: [121.05] });
    await expect(geocodingService.getRecent()).resolves.toEqual([]);
  });
});
