import { useEffect, useRef, useState } from 'react';
import { echo, retainChannel, releaseChannel, isSocketConnected } from '../services/echo';

interface UseEchoChannelOptions {
  /** Reverb private-channel name WITHOUT the `private-` prefix, e.g.
   *  `booking.<id>`. Must match a Broadcast::channel() pattern in the API's
   *  routes/channels.php. */
  channel: string;
  /** The event's server-side broadcastAs() name, e.g. `booking.status`. We
   *  prepend the leading `.` for Echo so it is treated as a raw event name and
   *  NOT namespaced under App\Events. */
  event: string;
  /**
   * When false, no subscription is opened. Callers that "disable" by passing a
   * null id MUST also pass `enabled: false` — otherwise the channel name
   * interpolates the literal `null` (e.g. `booking.null`), which fails auth and
   * churns a dead subscription.
   */
  enabled?: boolean;
  /** Receives the broadcast payload — i.e. the event's broadcastWith() array,
   *  delivered directly (NOT wrapped in any `{ new, old }` change envelope). */
  onEvent: (payload: any) => void;
}

/**
 * Subscribe to a single event on a private Reverb channel — the Echo
 * replacement for the app's previous realtime-subscription wrapper.
 *
 * `isConnected` is true once the socket is up AND this channel's subscription
 * has succeeded; it drops on subscription error or socket loss. The tracking
 * screen feeds it into its adaptive polling cadence, so it must reflect a
 * genuinely-live feed, never merely "socket attempted".
 */
export function useEchoChannel({
  channel: channelName,
  event,
  enabled = true,
  onEvent,
}: UseEchoChannelOptions) {
  const [isConnected, setIsConnected] = useState(false);

  // Ref-pin the callback so a changing `onEvent` identity doesn't tear down and
  // recreate the subscription on every render.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;
    const dottedEvent = `.${event}`;
    const channel = echo.private(channelName);
    retainChannel(channelName);

    const handler = (payload: any) => onEventRef.current(payload);
    channel.listen(dottedEvent, handler);

    // Subscription lifecycle → isConnected. `.subscribed` fires once the
    // channel-auth handshake completes; `.error` on a rejected/failed auth.
    const onSubscribed = () => {
      if (mounted) setIsConnected(true);
    };
    const onError = () => {
      if (mounted) setIsConnected(false);
    };
    channel.subscribed(onSubscribed);
    channel.error(onError);

    // A shared channel may already be subscribed by the time this hook mounts
    // (its `.subscribed` won't fire again), so seed from the live socket state.
    if (isSocketConnected()) onSubscribed();

    // Reflect socket drops immediately — every channel rides one connection.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connection = (echo.connector as any)?.pusher?.connection;
    const onStateChange = (states: { current: string }) => {
      if (mounted) setIsConnected(states.current === 'connected');
    };
    connection?.bind('state_change', onStateChange);

    return () => {
      mounted = false;
      // Remove only THIS hook's handler (pass the callback) so a co-subscriber
      // listening to the same event on a shared channel keeps its listener.
      channel.stopListening(dottedEvent, handler);
      connection?.unbind('state_change', onStateChange);
      releaseChannel(channelName);
      setIsConnected(false);
    };
  }, [channelName, event, enabled]);

  return { isConnected };
}
