import { isRunnerVerified, runnerVehicleLine } from '../runnerVehicle';

/**
 * The customer's tracking screen shows the runner's vehicle and plate (what
 * they check at the door) and a "verified" badge only for an APPROVED runner —
 * the badge used to be drawn on everyone.
 */
const runner = (profile: Record<string, unknown> | null | undefined) =>
  ({ id: 'r1', full_name: 'Jun Reyes', runner_profile: profile }) as any;

describe('runnerVehicleLine', () => {
  it('names the vehicle and the plate', () => {
    expect(runnerVehicleLine(runner({ vehicle_type: 'motorcycle', vehicle_plate: ' nbc 1234 ' }))).toBe(
      'Motorcycle · NBC 1234',
    );
  });

  it('copes with a vehicle that has no plate, or a plate with no type', () => {
    expect(runnerVehicleLine(runner({ vehicle_type: 'bicycle', vehicle_plate: null }))).toBe('Bicycle');
    expect(runnerVehicleLine(runner({ vehicle_type: 'walk' }))).toBe('On foot');
    expect(runnerVehicleLine(runner({ vehicle_plate: 'ABC 123' }))).toBe('ABC 123');
  });

  it('renders nothing when the payload has no profile (realtime / older reads)', () => {
    expect(runnerVehicleLine(runner(undefined))).toBeNull();
    expect(runnerVehicleLine(null)).toBeNull();
    expect(runnerVehicleLine(runner({}))).toBeNull();
  });
});

describe('isRunnerVerified', () => {
  it('is true only for an approved runner', () => {
    expect(isRunnerVerified(runner({ verification_status: 'approved' }))).toBe(true);
    for (const status of ['pending', 'rejected', 'resubmit', undefined, null]) {
      expect(isRunnerVerified(runner({ verification_status: status }))).toBe(false);
    }
    expect(isRunnerVerified(runner(undefined))).toBe(false);
    expect(isRunnerVerified(undefined)).toBe(false);
  });
});
