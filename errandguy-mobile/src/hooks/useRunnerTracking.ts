import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { useLocationStore } from '../stores/locationStore';
import type { RunnerLocation } from '../types';

export function useRunnerTracking(bookingId: string | null) {
  const { runnerLocation, setRunnerLocation } = useLocationStore();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!bookingId) return;

    // Defensive: subscribe to BOTH INSERT and UPDATE on `runner_locations`.
    // Append-only writes on the runner side hit INSERT, but if the
    // backend ever switches to upserting the latest fix per booking
    // (a common optimisation to keep the table small), the customer
    // would silently stop receiving live updates. Listening to '*'
    // future-proofs against either schema. We also ignore DELETEs
    // explicitly so a row purge mid-trip can't blank the runner pin.
    const channel = supabase
      .channel(`tracking:${bookingId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'runner_locations',
          filter: `booking_id=eq.${bookingId}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') return;
          const row = (payload.new ?? null) as RunnerLocation | null;
          if (row) setRunnerLocation(row);
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
