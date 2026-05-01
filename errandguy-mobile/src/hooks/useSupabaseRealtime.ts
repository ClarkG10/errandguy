import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseSupabaseRealtimeOptions {
  channel: string;
  table: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  filter?: string;
  schema?: string;
  onPayload: (payload: any) => void;
}

export function useSupabaseRealtime({
  channel: channelName,
  table,
  event = '*',
  filter,
  schema = 'public',
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
  }, [channelName, table, event, filter, schema]);

  return { isConnected };
}
