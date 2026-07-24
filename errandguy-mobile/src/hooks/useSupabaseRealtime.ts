import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseSupabaseRealtimeOptions {
  channel: string;
  table: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  filter?: string;
  schema?: string;
  /**
   * When false, no channel is opened. Callers that "disable" by passing a null
   * id MUST also pass `enabled: false` — a null id only drops the `filter`,
   * which would otherwise widen the subscription to the ENTIRE table (every
   * row) under a `<name>:null` channel instead of turning it off.
   */
  enabled?: boolean;
  onPayload: (payload: any) => void;
}

export function useSupabaseRealtime({
  channel: channelName,
  table,
  event = '*',
  filter,
  schema = 'public',
  enabled = true,
  onPayload,
}: UseSupabaseRealtimeOptions) {
  const [isConnected, setIsConnected] = useState(false);

  // Ref-pin the callback so changing the parent's `onPayload` identity
  // doesn't tear down + recreate the channel on every render. That
  // tear-down/recreate cycle is what triggers the runtime error
  // "cannot add `postgres_changes` callbacks for realtime:<name>
  // after `subscribe()`": supabase.channel(name) returns the same
  // channel singleton if one already exists with that name, and if
  // the previous instance hadn't been fully disposed yet (React
  // commit/cleanup ordering, especially under StrictMode), the
  // returned channel is already in the SUBSCRIBED state — adding
  // another listener after subscribe() is illegal.
  const onPayloadRef = useRef(onPayload);
  onPayloadRef.current = onPayload;

  useEffect(() => {
    // Defensive: if a stale channel with this name is still registered
    // (hot-reload, fast unmount/remount, double-effect under
    // StrictMode), drop it BEFORE creating the new one. Without this,
    // `supabase.channel(name)` hands us back the already-subscribed
    // singleton and the `.on()` call below throws.
    const existing = supabase.getChannels().find((c) => c.topic === `realtime:${channelName}`);
    if (existing) {
      supabase.removeChannel(existing);
    }

    // Disabled (e.g. a caller passed a null id): tear down any prior channel
    // above, then open nothing — never fall through to an unfiltered whole-table subscription.
    if (!enabled) return;

    const channel: RealtimeChannel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event,
          schema,
          table,
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          onPayloadRef.current(payload);
        },
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
      setIsConnected(false);
    };
  }, [channelName, table, event, filter, schema, enabled]);

  return { isConnected };
}
