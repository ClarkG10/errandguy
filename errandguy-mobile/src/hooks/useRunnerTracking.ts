import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { useLocationStore } from '../stores/locationStore';
import type { RunnerLocation } from '../types';

export function useRunnerTracking(bookingId: string | null) {
  // Per-field selectors: this hook feeds the heavy customer TrackingScreen, so a
  // whole-store useLocationStore() would re-render it on ANY location-store write
  // (e.g. the customer's own GPS slice), not just runner-pin updates.
  const runnerLocation = useLocationStore((s) => s.runnerLocation);
  const setRunnerLocation = useLocationStore((s) => s.setRunnerLocation);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!bookingId) return;

    // Drop any stale channel registered under this name before opening
    // a fresh one. See useChat / useSupabaseRealtime for full rationale
    // — supabase.channel(name) returns the same singleton when one
    // already exists, and adding listeners after subscribe() throws.
    const stale = supabase
      .getChannels()
      .find((c) => c.topic === `realtime:tracking:${bookingId}`);
    if (stale) supabase.removeChannel(stale);

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
