import AsyncStorage from '@react-native-async-storage/async-storage';
import { CacheService, CacheTTL } from './cache.service';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

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
  /** `[lng, lat]` — Mapbox convention. */
  center: [number, number];
}

function quantize(n: number): string {
  return n.toFixed(4);
}

/**
 * Forward + reverse geocoding with persistent cache.
 *
 * Reverse: keyed by quantised lng/lat (~11 m). The booking-details
 * screen used to fire a fresh network round-trip every time the map
 * settled — even when the user just dragged the pin a few metres.
 * This cuts that to one request per ~11 m grid cell per 24 h.
 *
 * Forward: keyed by trimmed lowercase query. Re-typing the same address
 * (very common when re-entering a flow) becomes free.
 */
export const geocodingService = {
  /** Reverse a coordinate to a human-readable place name. */
  async reverse(lng: number, lat: number): Promise<string> {
    if (!MAPBOX_TOKEN) return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    const key = `geocode:rev:${quantize(lng)},${quantize(lat)}`;
    try {
      return await CacheService.getOrFetch<string>(
        key,
        async () => {
          const res = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&language=en&limit=1`,
          );
          if (!res.ok) throw new Error(`mapbox_geocode_${res.status}`);
          const data = await res.json();
          const placeName = data.features?.[0]?.place_name;
          if (typeof placeName !== 'string' || placeName.length === 0) {
            throw new Error('mapbox_geocode_empty');
          }
          return placeName;
        },
        CacheTTL.STATIC, // 24 h
      );
    } catch {
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
  },

  /** Forward search — returns up to `limit` Philippines-scoped results.
   *  Optional `types` narrows the search (e.g. 'address,poi,place').
   *
   *  When `proximity` is supplied, Mapbox biases results to the area
   *  around that point — without this, a search for "starbucks" returns
   *  national hits instead of the cafe two blocks away. The proximity
   *  is also baked into the cache key so a Manila search and a Cebu
   *  search for the same query don't collide.
   */
  async search(
    query: string,
    limit = 8,
    types?: string,
    proximity?: { lng: number; lat: number },
  ): Promise<PlaceFeature[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2 || !MAPBOX_TOKEN) return [];
    const typesKey = types ?? 'all';
    // Quantise proximity to ~1 km grid so users walking around still
    // share cache hits. Tighter than that and the cache would barely
    // ever hit on a moving phone.
    const proxKey = proximity
      ? `${proximity.lng.toFixed(2)},${proximity.lat.toFixed(2)}`
      : 'none';
    const key = `geocode:fwd:${trimmed.toLowerCase()}:${limit}:${typesKey}:${proxKey}`;
    try {
      return await CacheService.getOrFetch<PlaceFeature[]>(
        key,
        async () => {
          const encoded = encodeURIComponent(trimmed);
          const typesParam = types ? `&types=${encodeURIComponent(types)}` : '';
          const proxParam = proximity
            ? `&proximity=${proximity.lng},${proximity.lat}`
            : '';
          // autocomplete=true returns partial matches as the user types
          // (e.g. "sm meg" → "SM Megamall"). Prior calls were missing
          // these, which made the search feel broken on short inputs.
          const res = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&country=ph&limit=${limit}&language=en&autocomplete=true${typesParam}${proxParam}`,
          );
          if (!res.ok) throw new Error(`mapbox_geocode_${res.status}`);
          const data = await res.json();
          return ((data.features ?? []) as any[]).map((f) => ({
            place_name: String(f.place_name ?? ''),
            center: f.center as [number, number],
          }));
        },
        // Forward results are short-lived because proximity-biased
        // results legitimately differ as the user moves. 5 min is
        // enough to absorb the rapid-fire keystroke storm without
        // leaking stale neighbourhood lists.
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
