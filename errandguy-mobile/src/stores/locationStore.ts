import { create } from 'zustand';
import { AppState, type NativeEventSubscription } from 'react-native';
import * as Location from 'expo-location';
import { runnerService } from '../services/runner.service';
import { useRunnerStore } from './runnerStore';
import { ensureLocationPermission, getCurrentCoords } from '../utils/locationPermission';
import type { Coordinate, RunnerLocation } from '../types';

/**
 * How old a runner's last ping may be before MatchingService stops considering
 * them for dispatch — `where('last_location_at', '>=', now()->subMinutes(5))`
 * on the eligible-runner query used by BOTH findRunner and broadcastToRunners
 * (errandguy-api/app/Services/MatchingService.php). Past this the runner is
 * still "online" in every UI sense but is invisible to every match.
 */
export const DISPATCH_STALE_AFTER_MS = 5 * 60_000;

/**
 * When we start TELLING the runner. Deliberately two minutes inside the
 * server's cutoff: the disclosure is only useful while there is still time to
 * act on it, and the home screen re-derives it on a 60s tick, so the warning
 * lands at worst ~4 min after the last ping — still ahead of dispatch dropping
 * them.
 */
export const DISPATCH_WARN_AFTER_MS = 3 * 60_000;

/**
 * Foreground re-ping cadence while online and NOT on an errand.
 *
 * Background location is deliberately not implemented (no paid Apple account),
 * so this is not a substitute for it — it closes a hole in the FOREGROUND
 * watch: `timeInterval` is Android-only in expo-location, and the watch's own
 * 30s heartbeat lives inside the position callback, so a runner sitting still
 * with the app open (the coffee-shop wait, the single most common idle posture)
 * emits nothing at all and silently ages out of matching. This re-POSTs the fix
 * we already hold — no GPS wake, one small request a minute.
 */
const IDLE_HEARTBEAT_MS = 60_000;

/**
 * True when OUR last successful ping is old enough to warn about.
 *
 * Keyed off a locally-recorded send time, never a server timestamp compared
 * against the device clock — a skewed phone would otherwise flap the warning.
 * `null` (nothing sent yet this session) is NOT stale on its own; the caller
 * falls back to `isServerLocationStale` for that case.
 */
export function isPingStale(lastPingAt: number | null, now: number = Date.now()): boolean {
  if (lastPingAt == null) return false;
  return now - lastPingAt > DISPATCH_WARN_AFTER_MS;
}

/**
 * Cold-start fallback: the server's own `last_location_at` (shipped on the self
 * runner-profile payload) says whether dispatch can see a runner the app has
 * not yet pinged for — e.g. the app was killed mid-shift and the server still
 * has them online.
 *
 * Uses the FULL server cutoff, not the earlier warn threshold, because this one
 * compares a server instant to the device clock: at 5 minutes the runner is
 * provably dropped, so a modest skew can't manufacture the warning.
 */
export function isServerLocationStale(
  lastLocationAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastLocationAt) return false;
  const at = Date.parse(lastLocationAt);
  if (!Number.isFinite(at)) return false;
  return now - at > DISPATCH_STALE_AFTER_MS;
}

interface LocationState {
  currentLocation: Coordinate | null;
  runnerLocation: RunnerLocation | null;
  watchId: Location.LocationSubscription | null;
  isTracking: boolean;
  /** Epoch-ms of the last ping the SERVER accepted, or null if none yet this
   *  session. This — not the watch callback firing — is what dispatch
   *  visibility actually depends on. */
  lastPingAt: number | null;
  /** A ping is in flight. Lets the UI say "reconnecting…" instead of flashing
   *  "dispatch can't see you" for the second it takes to restore visibility. */
  isPinging: boolean;

  setCurrentLocation: (location: Coordinate | null) => void;
  setRunnerLocation: (location: RunnerLocation | null) => void;
  startTracking: () => Promise<boolean>;
  stopTracking: () => void;
  /** Send ONE ping now. Never prompts for permission, never throws. */
  pingLocation: (opts?: { fresh?: boolean }) => Promise<boolean>;
}

/**
 * Foreground-only side rigs owned by startTracking/stopTracking. Module-scoped
 * rather than store fields because nothing renders them and they must never
 * participate in a selector — the store is a singleton, so exactly one of each
 * can exist.
 */
let heartbeatId: ReturnType<typeof setInterval> | null = null;
let appStateSub: NativeEventSubscription | null = null;
/** The single in-flight ping, shared by every concurrent caller. */
let inflightPing: Promise<boolean> | null = null;
/** Unsubscribe for the errand watcher that swaps the GPS profile. */
let errandSub: (() => void) | null = null;
/** The profile the live watch was armed with, so we only re-arm on a change. */
let armedProfile: TrackingProfile | null = null;

/**
 * GPS duty cycle. Two profiles, because a runner's day is mostly NOT an errand.
 *
 * The watch used to be armed at navigation grade — highest accuracy, a fix
 * every 6 seconds — for the entire time a runner was Online. But a runner is
 * online for hours waiting for offers, and during those hours the precision
 * buys nothing: no customer is watching a pin, and the only consumer is
 * MatchingService's radius query, which cannot tell 10 m from 150 m. All it
 * cost was the runner's battery — the thing they feel most, and the reason a
 * gig worker starts declining jobs to make it to the end of a shift.
 *
 * `active` is the unchanged original: a customer IS watching the pin, the ETA
 * and the "runner is nearby" alert depend on it, and turn-by-turn needs every
 * fix it can get.
 *
 * The accuracy FILTER has to move with the profile too. The callback drops
 * fixes coarser than `maxAccuracyMeters` so the customer's pin can't teleport
 * — but `Accuracy.Balanced` returns roughly 100 m fixes, so keeping the 75 m
 * gate would have silently discarded almost every idle fix and left the runner
 * ageing out of matching. That is the trap in this change, not the cadence.
 */
type TrackingProfile = 'active' | 'idle';

const TRACKING_PROFILES: Record<
  TrackingProfile,
  { options: Location.LocationOptions; maxAccuracyMeters: number }
> = {
  active: {
    options: {
      accuracy: Location.Accuracy.High,
      distanceInterval: 10,
      // Server throttles /runner/location to 1/5s. Watching at exactly
      // 5000ms races the throttle and produces sporadic 429s on every
      // 6th-or-so tick. 6000ms gives a 1s safety margin and matches
      // what the customer-side polling fallback expects to see.
      timeInterval: 6000,
    },
    // Drop low-confidence fixes (urban canyons, indoor wifi-only) so the
    // customer's tracking pin doesn't teleport.
    maxAccuracyMeters: 75,
  },
  idle: {
    options: {
      // Network/wifi-assisted rather than continuous GPS — the single biggest
      // battery lever available here.
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 150,
      timeInterval: 45_000,
    },
    // Generous on purpose: matching works in kilometres, and a gate tighter
    // than the profile's own precision would reject everything it produces.
    maxAccuracyMeters: 400,
  },
};

/**
 * Which profile the runner's CURRENT situation calls for.
 *
 * Derived from the errand they hold rather than from which screen is mounted:
 * the store already reads `currentErrand` for its idle heartbeat, and deriving
 * it here means nesting (cockpit → turn-by-turn → back) can't leave the watch
 * on the wrong profile, and no screen has to remember to ask.
 */
const profileForNow = (): TrackingProfile =>
  useRunnerStore.getState().currentErrand ? 'active' : 'idle';

const clearSideRigs = () => {
  if (heartbeatId) {
    clearInterval(heartbeatId);
    heartbeatId = null;
  }
  if (appStateSub) {
    appStateSub.remove();
    appStateSub = null;
  }
  if (errandSub) {
    errandSub();
    errandSub = null;
  }
  armedProfile = null;
};

export const useLocationStore = create<LocationState>((set, get) => ({
  currentLocation: null,
  runnerLocation: null,
  watchId: null,
  isTracking: false,
  lastPingAt: null,
  isPinging: false,

  setCurrentLocation: (location) => set({ currentLocation: location }),

  // Monotonic by fix time (RT-3). The customer tracking screen writes this one
  // slot from TWO concurrent sources: the realtime `runner.location` broadcast
  // (~every 5s) and a /track reconcile poll that keeps running even while
  // realtime is healthy (every 20s). The poll's in-flight response necessarily
  // carries an OLDER fix than any realtime tick that landed during its
  // round-trip, so an unconditional overwrite snapped the map pin backward
  // roughly every 20s. Ignore any incoming fix that is not strictly newer than
  // the current one (comparing the server-stamped created_at/updated_at, which
  // both writers pass).
  //
  // CRITICAL: enforce monotonicity ONLY within the SAME (booking, runner)
  // stream. This slot is global and never cleared, so when the customer
  // switches from tracking booking A to booking B, it still holds A's fix. If
  // B's newest fix happens to be older than A's last-seen fix (B's runner has
  // been idle longer), a blanket timestamp compare would pin A's stale runner
  // on B's map. A different booking/runner — and a clear (null) — always apply.
  setRunnerLocation: (location) =>
    set((state) => {
      const current = state.runnerLocation;
      const sameStream =
        !!location &&
        !!current &&
        location.booking_id === current.booking_id &&
        location.runner_id === current.runner_id;
      if (sameStream) {
        const incomingT = Date.parse(location!.created_at);
        const currentT = Date.parse(current!.created_at);
        if (
          Number.isFinite(incomingT) &&
          Number.isFinite(currentT) &&
          incomingT <= currentT
        ) {
          return state; // stale or same-age within this stream → keep current
        }
      }
      return { runnerLocation: location };
    }),

  /**
   * Send ONE location ping right now and record whether the server took it.
   *
   *   fresh: true  → try for a new GPS fix first (manual "refresh my location"
   *                  tap, or the app returning to the foreground).
   *   fresh: false → re-POST the fix we already hold. Zero GPS cost; used by
   *                  the idle heartbeat.
   *
   * Never prompts for permission (`requirePermission: false`), so it is safe on
   * a plain foregrounding — the app deliberately never pops the OS dialog
   * outside an explicit user action. Never throws: the caller reads the bool.
   */
  pingLocation: ({ fresh = false } = {}) => {
    // Share an in-flight ping (same idiom as useQuery's inflightRef): the
    // foreground listener and a runner's own "refresh" tap can land in the same
    // moment, and two overlapping pings would race the server's 1-per-5s
    // throttle AND let the loser's `finally` clear isPinging under the winner.
    if (inflightPing) return inflightPing;

    const run = async (): Promise<boolean> => {
      let coords = get().currentLocation;
      let gotFreshFix = false;

      set({ isPinging: true });
      try {
        if (fresh) {
          const pos = await getCurrentCoords({
            requirePermission: false,
            accuracy: Location.Accuracy.Balanced,
            timeoutMs: 6000,
          }).catch(() => null);
          if (pos) {
            coords = { lat: pos.lat, lng: pos.lng };
            gotFreshFix = true;
          }
        }
        if (!coords) return false;
        // Only publish a genuinely NEW fix — re-posting the one we already hold
        // must not notify every currentLocation subscriber for nothing.
        if (gotFreshFix) set({ currentLocation: coords });

        // A re-POST of an OLD fix must NOT be tagged to a booking: the
        // customer's tracking screen renders the newest row and would present
        // a stale position with a fresh "updated just now". Only a genuinely
        // new fix carries the booking id. Matching reads the denormalised
        // profile position, which an untagged ping refreshes just the same.
        const bookingId = gotFreshFix
          ? (useRunnerStore.getState().currentErrand?.id ?? null)
          : null;

        try {
          await runnerService.updateLocation({ ...coords, booking_id: bookingId });
          set({ lastPingAt: Date.now() });
          return true;
        } catch (err) {
          // 429 is the server's own 1-per-5s throttle (LocationService), i.e. a
          // FRESHER ping landed moments ago — dispatch can see us. Counting
          // that as a failure would make the staleness disclosure flap.
          const status =
            (err as { status?: number; response?: { status?: number } })?.status ??
            (err as { response?: { status?: number } })?.response?.status;
          if (status === 429) {
            set({ lastPingAt: Date.now() });
            return true;
          }
          return false;
        }
      } finally {
        set({ isPinging: false });
        inflightPing = null;
      }
    };

    inflightPing = run();
    return inflightPing;
  },

  startTracking: async () => {
    // Defensive: if a previous watcher is still alive (e.g. re-mount of
    // the runner home after a quick navigation), tear it down first so we
    // never leak duplicate subscriptions that would double-send GPS to
    // the backend and double-charge our rate limit.
    const existing = get().watchId;
    if (existing) {
      existing.remove();
      // Deliberately NOT flipping `isTracking` here. This path also runs when
      // re-arming at a different GPS profile, and the cockpit and turn-by-turn
      // screens both re-arm on `!isTracking` — so a momentary false across the
      // `await` below would have them fire a CONCURRENT startTracking and leak
      // a duplicate watch, double-sending GPS. The permission-denied branch
      // below sets it false explicitly, which is the only case that needs it.
      set({ watchId: null });
    }
    // …and its foreground rigs, so re-arming can never double-heartbeat.
    clearSideRigs();

    // ensureLocationPermission handles the "denied once, can't re-prompt"
    // case by offering a deep-link into Settings — without it the runner
    // could get permanently stuck unable to go Online after a single deny.
    const ok = await ensureLocationPermission({ feature: 'share your live location with customers' });
    if (!ok) {
      // Caller (e.g. runner home toggle) needs to know permission was
      // denied so it can show an actionable toast — otherwise the
      // runner appears Online but never emits GPS and the customer
      // tracking screen sits empty.
      set({ isTracking: false });
      return false;
    }

    // Last successfully reported location — used to suppress jittery
    // sub-meter updates that some Android devices emit while stationary.
    let lastSent: { lat: number; lng: number; t: number } | null = null;

    const profile = profileForNow();
    const { options, maxAccuracyMeters } = TRACKING_PROFILES[profile];

    const subscription = await Location.watchPositionAsync(
      options,
      (location) => {
        // Drop fixes coarser than this profile expects — see TRACKING_PROFILES.
        const acc = location.coords.accuracy;
        if (typeof acc === 'number' && acc > maxAccuracyMeters) return;

        const rawHeading = location.coords.heading;
        const rawSpeed = location.coords.speed;
        const coords = {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          // iOS/Android emit -1 when heading/speed are unknown; treat
          // those as "no data" instead of forwarding nonsense to the API.
          heading:
            typeof rawHeading === 'number' && rawHeading >= 0 ? rawHeading : undefined,
          speed: typeof rawSpeed === 'number' && rawSpeed >= 0 ? rawSpeed : undefined,
        };

        // Heartbeat: always send if 30s have passed since the last push,
        // even if the runner hasn't moved — gives the customer fresh
        // "updated 12s ago" copy and confirms the runner is still online.
        const now = Date.now();
        if (lastSent) {
          // Equirectangular distance in metres. The previous version
          // compared raw degree deltas with `Math.hypot(dLat, dLng) > 0.00007`,
          // which is latitude-dependent — at Manila's ~14°N a degree of
          // longitude is ~108 km, so 0.00007° ≈ 7.5 m, but at higher
          // latitudes the same threshold would silently drop perfectly
          // valid 10m moves. Convert to actual metres so the threshold
          // means what it claims regardless of where the runner is.
          const dLatM = (coords.lat - lastSent.lat) * 111_000;
          const dLngM =
            (coords.lng - lastSent.lng) *
            111_000 *
            Math.cos((lastSent.lat * Math.PI) / 180);
          const movedMeters = Math.sqrt(dLatM * dLatM + dLngM * dLngM);
          if (movedMeters < 8 && now - lastSent.t < 30_000) return;
        }
        lastSent = { lat: coords.lat, lng: coords.lng, t: now };

        set({
          currentLocation: { lat: coords.lat, lng: coords.lng },
        });
        // Send location to backend so customer can track runner in realtime.
        // Pass the active booking id explicitly so the row is written with
        // booking_id set immediately — without this the backend resolves
        // the booking via a 30s cache, leaving the first few pings after
        // a match tagged NULL and invisible to the customer's realtime
        // subscription (which filters on booking_id=eq.…).
        const activeErrandId = useRunnerStore.getState().currentErrand?.id ?? null;
        runnerService
          .updateLocation({ ...coords, booking_id: activeErrandId })
          // Stamp the SEND, not the fix: dispatch visibility depends on the
          // server having taken the ping, and this is the only place that
          // knows it did. (429 = throttled duplicate, i.e. a fresher ping
          // already landed — also visible, see pingLocation.)
          .then(() => set({ lastPingAt: Date.now() }))
          .catch((err) => {
            const status =
              (err as { status?: number; response?: { status?: number } })?.status ??
              (err as { response?: { status?: number } })?.response?.status;
            if (status === 429) set({ lastPingAt: Date.now() });
            // Network drop — keep the watcher alive; the next valid fix
            // will retry. Resetting `lastSent` would just spam the queue.
          });
      },
    );

    // Optimistic seed: going online PUTs /runner/online WITH coords, which the
    // server writes straight to current_lat/lng + last_location_at — so at the
    // instant we arm the watch the runner really is visible. Without this seed
    // the cold `null` would fall through to the server-timestamp fallback (a
    // profile payload cached from before the toggle) and flash the "can't see
    // you" warning for the second before the first real ping lands.
    set({ watchId: subscription, isTracking: true, lastPingAt: Date.now() });
    armedProfile = profile;

    // Restore visibility immediately rather than waiting on the watch's first
    // callback — which, for a stationary device, may never come at all.
    void get().pingLocation({ fresh: true });

    // Foreground heartbeat — see IDLE_HEARTBEAT_MS. Idle only: while an errand
    // is in hand the runner is moving (so the watch fires) and the customer's
    // pin must be fed by real fixes.
    heartbeatId = setInterval(() => {
      const s = get();
      if (!s.isTracking) return;
      if (useRunnerStore.getState().currentErrand) return;
      // Don't stack on top of a ping the watch just made.
      if (s.lastPingAt != null && Date.now() - s.lastPingAt < IDLE_HEARTBEAT_MS - 5_000) return;
      void get().pingLocation({ fresh: false });
    }, IDLE_HEARTBEAT_MS);

    // Returning to the app is exactly when visibility has to be rebuilt: the
    // foreground watch was suspended while backgrounded, so last_location_at
    // is already minutes old and matching has dropped the runner. One fresh fix
    // (never a permission prompt) puts them back in the pool in about a second.
    appStateSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (!get().isTracking) return;
      void get().pingLocation({ fresh: true });
    });

    // Swap the GPS duty cycle the moment the runner takes or finishes an
    // errand. Driven off the errand itself rather than screen mounts, so the
    // upgrade happens even if the runner accepts from a notification and never
    // opens the cockpit, and the downgrade happens even if they close the app
    // on the completion screen — the two paths that would otherwise leave a
    // phone burning navigation-grade GPS with no errand in hand.
    errandSub = useRunnerStore.subscribe((state, prev) => {
      // Only the presence of an errand matters, not its status changing.
      if (!!state.currentErrand === !!prev.currentErrand) return;
      const wanted = profileForNow();
      if (!get().isTracking || armedProfile === wanted) return;
      // Re-arm through startTracking so there is ONE arming path: it tears the
      // previous watch and rigs down first, and permission is already granted
      // so it cannot prompt again here.
      void get().startTracking();
    });

    return true;
  },

  stopTracking: () => {
    const { watchId } = get();
    if (watchId) {
      watchId.remove();
    }
    clearSideRigs();
    // Offline: freshness is meaningless (and the hero's disclosure is gated on
    // isOnline anyway), so don't leave a timestamp behind for the next shift.
    set({ watchId: null, isTracking: false, lastPingAt: null, isPinging: false });
  },
}));
