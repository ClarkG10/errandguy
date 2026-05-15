import AsyncStorage from '@react-native-async-storage/async-storage';
import { CacheService, CacheTTL } from './cache.service';

const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

/**
 * Persistent store for recently chosen places. Backs the empty-state
 * suggestion list in the booking search sheet so the user doesn't have
 * to retype "home" / "office" / their favourite cafe every booking.
 *
 * MRU semantics: most recently selected is first. Capped at 8 entries
 * to avoid bloat. De-duplicated by quantised coordinate (so picking the
 * exact same pin twice doesn't push two rows in).
 */
const RECENT_PLACES_KEY = '@errandguy:recent_places';
const RECENT_PLACES_CAP = 8;

export interface PlaceFeature {
  place_name: string;
  /** `[lng, lat]` — kept for compatibility. */
  center: [number, number];
}

function quantize(n: number): string {
  return n.toFixed(4);
}

export const geocodingService = {
  /** Reverse a coordinate to a human-readable place name. */
  async reverse(lng: number, lat: number): Promise<string> {
    if (!GOOGLE_MAPS_KEY) return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    const key = `geocode:rev:${quantize(lng)},${quantize(lat)}`;
    try {
      return await CacheService.getOrFetch<string>(
        key,
        async () => {
          const res = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_KEY}&language=en&result_type=street_address|route|sublocality|locality`,
          );
          if (!res.ok) throw new Error(`google_geocode_${res.status}`);
          const data = await res.json();
          if (data.status !== 'OK') throw new Error(`google_geocode_${data.status}`);
          const placeName = data.results?.[0]?.formatted_address;
          if (typeof placeName !== 'string' || placeName.length === 0) {
            throw new Error('google_geocode_empty');
          }
          return placeName;
        },
        CacheTTL.STATIC, // 24 h
      );
    } catch {
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
  },

  /**
   * Forward search — returns up to `limit` Philippines-scoped results.
   *
   * Uses Google Places Autocomplete API which has far better coverage
   * for Philippine addresses, barangay names, and landmarks than Mapbox.
   * Optional `proximity` biases results toward a coordinate.
   */
  async search(
    query: string,
    limit = 8,
    types?: string,
    proximity?: { lng: number; lat: number },
  ): Promise<PlaceFeature[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2 || !GOOGLE_MAPS_KEY) return [];
    const typesKey = types ?? 'all';
    const proxKey = proximity
      ? `${proximity.lng.toFixed(2)},${proximity.lat.toFixed(2)}`
      : 'none';
    const key = `geocode:fwd:${trimmed.toLowerCase()}:${limit}:${typesKey}:${proxKey}`;
    try {
      return await CacheService.getOrFetch<PlaceFeature[]>(
        key,
        async () => {
          const encoded = encodeURIComponent(trimmed);
          const locationBias = proximity
            ? `&location=${proximity.lat},${proximity.lng}&radius=50000`
            : `&location=12.8797,121.7740&radius=600000`; // PH center, 600 km radius
          const res = await fetch(
            `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
              `?input=${encoded}` +
              `&key=${GOOGLE_MAPS_KEY}` +
              `&language=en` +
              `&components=country:ph` +
              `&sessiontoken=errandguy` +
              locationBias,
          );
          if (!res.ok) throw new Error(`google_autocomplete_${res.status}`);
          const data = await res.json();
          if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
            throw new Error(`google_autocomplete_${data.status}`);
          }
          const predictions = (data.predictions ?? []).slice(0, limit) as any[];
          // Autocomplete only gives us a place_id — we need to resolve
          // coordinates via Place Details. Do them in parallel (max 4
          // at once so we don't hammer quota).
          const results: PlaceFeature[] = [];
          const batch = predictions.slice(0, 4);
          await Promise.all(
            batch.map(async (p: any) => {
              try {
                const detailRes = await fetch(
                  `https://maps.googleapis.com/maps/api/place/details/json` +
                    `?place_id=${p.place_id}` +
                    `&fields=formatted_address,geometry` +
                    `&key=${GOOGLE_MAPS_KEY}`,
                );
                const detail = await detailRes.json();
                const loc = detail.result?.geometry?.location;
                const addr = detail.result?.formatted_address ?? p.description;
                if (loc?.lat != null && loc?.lng != null) {
                  results.push({
                    place_name: String(addr),
                    center: [loc.lng, loc.lat],
                  });
                }
              } catch {
                // If details fail, still include with a rough center
                results.push({
                  place_name: String(p.description ?? ''),
                  center: proximity ? [proximity.lng, proximity.lat] : [121.0, 14.6],
                });
              }
            }),
          );
          return results;
        },
        CacheTTL.MEDIUM,
      );
    } catch {
      return [];
    }
  },

  /**
   * Read the user's recent destinations (most-recent first). Safe to
   * call from render — never throws.
   */
  async getRecent(limit: number = RECENT_PLACES_CAP): Promise<PlaceFeature[]> {
    try {
      const raw = await AsyncStorage.getItem(RECENT_PLACES_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter(
          (x): x is PlaceFeature =>
            !!x &&
            typeof x.place_name === 'string' &&
            Array.isArray(x.center) &&
            x.center.length === 2 &&
            typeof x.center[0] === 'number' &&
            typeof x.center[1] === 'number',
        )
        .slice(0, limit);
    } catch {
      return [];
    }
  },

  /**
   * Promote a place to the top of the recents list. Dedupes by ~11 m
   * grid cell so re-picking the exact same pin doesn't grow the list.
   */
  async addRecent(place: PlaceFeature): Promise<void> {
    if (!place?.place_name || !Array.isArray(place.center)) return;
    try {
      const existing = await this.getRecent(RECENT_PLACES_CAP);
      const key = `${quantize(place.center[0])},${quantize(place.center[1])}`;
      const filtered = existing.filter(
        (p) => `${quantize(p.center[0])},${quantize(p.center[1])}` !== key,
      );
      const next = [place, ...filtered].slice(0, RECENT_PLACES_CAP);
      await AsyncStorage.setItem(RECENT_PLACES_KEY, JSON.stringify(next));
    } catch {
      /* non-critical */
    }
  },

  /** Wipe recents (e.g. on logout). */
  async clearRecent(): Promise<void> {
    try {
      await AsyncStorage.removeItem(RECENT_PLACES_KEY);
    } catch {
      /* non-critical */
    }
  },
};
