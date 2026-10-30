import type { Booking } from '../types';

type BookingRunner = NonNullable<Booking['runner']>;

const VEHICLE_LABELS: Record<string, string> = {
  walk: 'On foot',
  bicycle: 'Bicycle',
  motorcycle: 'Motorcycle',
  car: 'Car',
};

/**
 * "Motorcycle · NBC 1234" — what the customer looks for at the door.
 *
 * Read from the runner's own profile on the booking (BookingResource →
 * UserResource → runner_profile). Realtime payloads and older reads omit it,
 * so every part is optional and a missing profile simply renders nothing.
 */
export function runnerVehicleLine(runner: BookingRunner | null | undefined): string | null {
  const profile = runner?.runner_profile;
  if (!profile) return null;
  const type = profile.vehicle_type ? VEHICLE_LABELS[profile.vehicle_type] ?? null : null;
  const plate =
    typeof profile.vehicle_plate === 'string' && profile.vehicle_plate.trim()
      ? profile.vehicle_plate.trim().toUpperCase()
      : null;
  const parts = [type, plate].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Only an APPROVED runner wears the verified badge. The badge used to be drawn
 * on every assigned runner, which promised a check nobody had confirmed for
 * this one; an unknown status (field absent) is not a yes.
 */
export function isRunnerVerified(runner: BookingRunner | null | undefined): boolean {
  return runner?.runner_profile?.verification_status === 'approved';
}
