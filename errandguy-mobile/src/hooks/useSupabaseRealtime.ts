import { useEffect, useState } from 'react';
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

  useEffect(() => {
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
          onPayload(payload);
        },
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
      setIsConnected(false);
    };
  }, [channelName, table, event, filter, schema, onPayload]);

  return { isConnected };
}
