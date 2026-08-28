import {
  DEFAULT_SPEED_KMH,
  VEHICLE_SPEED_KMH,
  etaMinutesFromDistanceKm,
  etaMinutesFromDistanceMeters,
  formatEtaMinutes,
  profileForVehicle,
} from '../route.service';

/**
 * The ETA speed table is a FALLBACK for when no real route duration is
 * available. These tests pin the numbers that used to live duplicated in
 * book/details.tsx and book/review.tsx so a future edit can't silently change
 * what a customer is quoted, and pin the profile-aware behaviour useEta now
 * relies on (its fallback used to be a flat 30 km/h for walking too).
 */
describe('route.service ETA fallback', () => {
  describe('etaMinutesFromDistanceKm', () => {
    it('reproduces the legacy per-vehicle speed table', () => {
      // 10 km at the documented speeds.
      expect(etaMinutesFromDistanceKm(10, 'walk')).toBe(120); // 5 km/h
      expect(etaMinutesFromDistanceKm(10, 'bicycle')).toBe(40); // 15 km/h
      expect(etaMinutesFromDistanceKm(10, 'motorcycle')).toBe(17); // 35 km/h
      expect(etaMinutesFromDistanceKm(10, 'car')).toBe(20); // 30 km/h
    });

    it('falls back to the default speed for an unknown vehicle', () => {
      expect(etaMinutesFromDistanceKm(10, 'jeepney')).toBe(
        Math.round((10 / DEFAULT_SPEED_KMH) * 60),
      );
      expect(etaMinutesFromDistanceKm(10)).toBe(20);
    });

    it('returns null rather than a fabricated number for unusable input', () => {
      expect(etaMinutesFromDistanceKm(null)).toBeNull();
      expect(etaMinutesFromDistanceKm(undefined)).toBeNull();
      expect(etaMinutesFromDistanceKm(Number.NaN)).toBeNull();
      expect(etaMinutesFromDistanceKm(-3)).toBeNull();
    });

    it('can return 0 so the caller can render "< 1 min"', () => {
      expect(etaMinutesFromDistanceKm(0.1, 'car')).toBe(0);
      expect(formatEtaMinutes(etaMinutesFromDistanceKm(0.1, 'car'))).toBe('< 1 min');
    });
  });

  describe('etaMinutesFromDistanceMeters', () => {
    it('is profile-aware — walking is not quoted at driving speed', () => {
      expect(etaMinutesFromDistanceMeters(3_000, 'walking')).toBe(36); // 5 km/h
      expect(etaMinutesFromDistanceMeters(3_000, 'cycling')).toBe(12); // 15 km/h
      expect(etaMinutesFromDistanceMeters(3_000, 'driving')).toBe(6); // 30 km/h
    });

    it('defaults to driving and rejects unusable input', () => {
      expect(etaMinutesFromDistanceMeters(3_000)).toBe(6);
      expect(etaMinutesFromDistanceMeters(null)).toBeNull();
      expect(etaMinutesFromDistanceMeters(Number.NaN, 'walking')).toBeNull();
    });
  });

  describe('profileForVehicle', () => {
    it('maps booking vehicle keys onto routing profiles', () => {
      expect(profileForVehicle('walk')).toBe('walking');
      expect(profileForVehicle('bicycle')).toBe('cycling');
      expect(profileForVehicle('motorcycle')).toBe('driving');
      expect(profileForVehicle('car')).toBe('driving');
      expect(profileForVehicle(null)).toBe('driving');
      expect(profileForVehicle(undefined)).toBe('driving');
    });
  });

  describe('formatEtaMinutes', () => {
    it('matches the copy the booking screens already render', () => {
      expect(formatEtaMinutes(0)).toBe('< 1 min');
      expect(formatEtaMinutes(1)).toBe('1 min');
      expect(formatEtaMinutes(59)).toBe('59 min');
      expect(formatEtaMinutes(60)).toBe('1h 0m');
      expect(formatEtaMinutes(95)).toBe('1h 35m');
    });

    it('returns null when there is nothing to show', () => {
      expect(formatEtaMinutes(null)).toBeNull();
      expect(formatEtaMinutes(undefined)).toBeNull();
      expect(formatEtaMinutes(Number.NaN)).toBeNull();
    });
  });

  it('keeps the speed table exported for the screens that still inline it', () => {
    expect(VEHICLE_SPEED_KMH).toEqual({
      walk: 5,
      bicycle: 15,
      motorcycle: 35,
      car: 30,
    });
  });
});
