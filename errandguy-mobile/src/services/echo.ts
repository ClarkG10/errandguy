import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import axios from 'axios';
import { secureStorage } from '../utils/storage';

// laravel-echo's reverb/pusher connector reads a global `Pusher`. pusher-js is
// pure JS and transports over React Native's built-in WebSocket — the same
// primitive @supabase/supabase-js realtime used — so this ships over-the-air
// with no native rebuild.
// @ts-expect-error — augmenting the RN global with the Pusher constructor.
global.Pusher = Pusher;

// The broadcasting-auth route lives at the app ROOT (/broadcasting/auth), not
// under the /api/v1 prefix the REST client uses — derive the origin from the
// API URL so private-channel authorization hits the right path.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const ORIGIN = API_URL.replace(/\/api\/v\d+\/?$/, '');

const REVERB_PORT = Number(process.env.EXPO_PUBLIC_REVERB_PORT ?? 443);
const REVERB_TLS = (process.env.EXPO_PUBLIC_REVERB_SCHEME ?? 'https') === 'https';

/** Current Sanctum bearer — peek the in-memory cache first (the axios client
 *  keeps it warm), fall back to the async SecureStore read on cold start. */
async function currentToken(): Promise<string | null> {
  const peeked = secureStorage.peek('auth_token');
  if (peeked !== undefined) return peeked;
  return secureStorage.get('auth_token');
}

/**
 * Singleton Echo client pointed at the self-hosted Reverb server. One WebSocket
 * connection is multiplexed across every private channel the app subscribes to.
 *
 * We use a custom `authorizer` (rather than static `auth.headers`) so each
 * channel-subscription request carries the CURRENT bearer token — Echo is
 * constructed once at module load, but the token changes on login/logout/
 * refresh, and a stale header would 403 every subscription after re-auth.
 */
export const echo = new Echo({
  broadcaster: 'reverb',
  key: process.env.EXPO_PUBLIC_REVERB_KEY,
  wsHost: process.env.EXPO_PUBLIC_REVERB_HOST,
  wsPort: REVERB_PORT,
  wssPort: REVERB_PORT,
  forceTLS: REVERB_TLS,
  enabledTransports: ['ws', 'wss'],
  // Don't hammer a dead socket forever; pusher-js will retry with backoff.
  authorizer: (channel: { name: string }) => ({
    authorize: async (
      socketId: string,
      // Matches laravel-echo's ChannelAuthorizationCallback (opaque pusher-
      // protocol auth payload). `any` on the data slot sidesteps the library's
      // internal ChannelAuthorizationData type without importing it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback: (error: Error | null, data: any) => void,
    ) => {
      try {
        const token = await currentToken();
        const res = await axios.post(
          `${ORIGIN}/broadcasting/auth`,
          { socket_id: socketId, channel_name: channel.name },
          {
            headers: {
              Accept: 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            timeout: 15000,
          },
        );
        callback(null, res.data);
      } catch (err) {
        callback(err instanceof Error ? err : new Error(String(err)), null);
      }
    },
  }),
});

/** Reference-count of live subscribers per channel name. Two hooks can share a
 *  channel (e.g. booking status + runner location both on `booking.{id}`), so
 *  we only tear the channel down once the LAST subscriber unmounts — otherwise
 *  the first unmount would kill the other's live feed. */
const channelRefs = new Map<string, number>();

export function retainChannel(name: string): void {
  channelRefs.set(name, (channelRefs.get(name) ?? 0) + 1);
}

/** Decrement the ref-count; leave the channel (all pusher variants) when it
 *  hits zero. Returns the remaining count. */
export function releaseChannel(name: string): number {
  const next = (channelRefs.get(name) ?? 1) - 1;
  if (next <= 0) {
    channelRefs.delete(name);
    echo.leave(name); // leaves `name`, `private-{name}`, `presence-{name}`
    return 0;
  }
  channelRefs.set(name, next);
  return next;
}

/** True while the underlying WebSocket is connected. All channels share it. */
export function isSocketConnected(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (echo.connector as any)?.pusher?.connection?.state === 'connected';
}
