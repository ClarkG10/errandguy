import AsyncStorage from '@react-native-async-storage/async-storage';
import { CacheService, CacheTTL } from './cache.service';

const HERE_API_KEY = process.env.EXPO_PUBLIC_HERE_API_KEY ?? '';

if (!HERE_API_KEY) {
  console.error('[geocoding] EXPO_PUBLIC_HERE_API_KEY is EMPTY — geocoding disabled. Check your .env file.');
} else {
  console.log(`[geocoding] HERE API key loaded (${HERE_API_KEY.slice(0, 8)}…)`);
}

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
    if (!HERE_API_KEY) {
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
    const key = `geocode:here:rev:${quantize(lng)},${quantize(lat)}`;
    try {
      return await CacheService.getOrFetch<string>(
        key,
        async () => {
          const url =
            `https://revgeocode.search.hereapi.com/v1/revgeocode` +
            `?at=${lat},${lng}` +
            `&lang=en-US` +
            `&apiKey=${HERE_API_KEY}`;
          console.log(`[geocoding.reverse] Fetching: at=${lat},${lng}`);
          const res = await fetch(url);
          if (!res.ok) throw new Error(`here_revgeocode_http_${res.status}`);
          const data = await res.json();
          console.log(`[geocoding.reverse] items: ${data.items?.length ?? 0}`);
          const item = data.items?.[0];
          if (!item) throw new Error('here_revgeocode_empty');
          const placeName: string = item.address?.label ?? item.title ?? '';
          if (!placeName) throw new Error('here_revgeocode_no_label');
          console.log(`[geocoding.reverse] ✓ resolved to: "${placeName}"`);
          return placeName;
        },
        CacheTTL.STATIC,
      );
    } catch (err) {
      console.error('[geocoding.reverse] Error:', err);
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
  },

  /**
   * Forward search — returns up to `limit` Philippines-scoped results.
   * Uses HERE Discover API (no billing required, generous free tier).
   */
  async search(
    query: string,
    limit = 8,
    _types?: string,
    proximity?: { lng: number; lat: number },
  ): Promise<PlaceFeature[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    if (!HERE_API_KEY) return [];
    const proxKey = proximity
      ? `${proximity.lng.toFixed(2)},${proximity.lat.toFixed(2)}`
      : 'none';
    const key = `geocode:here:fwd:${trimmed.toLowerCase()}:${limit}:${proxKey}`;
    try {
      return await CacheService.getOrFetch<PlaceFeature[]>(
        key,
        async () => {
          const encoded = encodeURIComponent(trimmed);
          // Proximity: use caller-supplied point or center of Philippines
          const at = proximity
            ? `${proximity.lat},${proximity.lng}`
            : `12.8797,121.7740`;
          const url =
            `https://discover.search.hereapi.com/v1/discover` +
            `?q=${encoded}` +
            `&in=countryCode:PHL` +
            `&at=${at}` +
            `&lang=en` +
            `&limit=${limit}` +
            `&apiKey=${HERE_API_KEY}`;
          console.log(`[geocoding.search] Query: "${trimmed}", proximity: ${proxKey}`);
          const res = await fetch(url);
          if (!res.ok) throw new Error(`here_discover_http_${res.status}`);
          const data = await res.json();
          const items: any[] = data.items ?? [];
          const results = items
            .filter((item) => item.position)
            .slice(0, limit)
            .map((item) => ({
              place_name: String(item.address?.label ?? item.title ?? ''),
              center: [item.position.lng, item.position.lat] as [number, number],
            }));
          console.log(`[geocoding.search] ✓ returning ${results.length} results`);
          return results;
        },
        CacheTTL.MEDIUM,
      );
    } catch (err) {
      console.error('[geocoding.search] Error:', err);
      return [];
    }
  },

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

  async clearRecent(): Promise<void> {
    try {
      await AsyncStorage.removeItem(RECENT_PLACES_KEY);
    } catch {
      /* non-critical */
    }
  },
};
