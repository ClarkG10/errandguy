import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { useLocationStore } from '../stores/locationStore';
import type { RunnerLocation } from '../types';

export function useRunnerTracking(bookingId: string | null) {
  const { runnerLocation, setRunnerLocation } = useLocationStore();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!bookingId) return;

    const channel = supabase
      .channel(`tracking:${bookingId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'runner_locations',
          filter: `booking_id=eq.${bookingId}`,
        },
        (payload) => {
          setRunnerLocation(payload.new as RunnerLocation);
        },
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
      setIsConnected(false);
    };
  }, [bookingId, setRunnerLocation]);

  return {
    runnerLocation,
    isConnected,
  };
}
