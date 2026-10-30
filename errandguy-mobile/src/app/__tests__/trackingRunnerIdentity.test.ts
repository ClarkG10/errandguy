import fs from 'fs';
import path from 'path';

/**
 * The customer must be able to recognise their runner at the door — vehicle
 * and plate — and the "verified" badge must be earned: it used to be drawn on
 * every assigned runner, approved or not. The pure helpers are covered in
 * utils/__tests__/runnerVehicle.test.ts; this pins the screen to them.
 */
const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '(customer)', 'tracking', '[id].tsx'),
  'utf8',
);

describe('customer tracking — who is coming', () => {
  it('never draws an unconditional verified badge', () => {
    expect(SOURCE).not.toMatch(/isVerified\s*\n\s*\/>/);
    expect(SOURCE).not.toMatch(/isVerified\s*\/>/);
    expect(SOURCE.match(/isVerified=\{runnerVerified\}/g)?.length).toBe(2);
    expect(SOURCE).toContain('const runnerVerified = isRunnerVerified(booking.runner);');
  });

  it('shows the vehicle and plate from the booking’s runner profile', () => {
    expect(SOURCE).toContain('const runnerVehicle = runnerVehicleLine(booking.runner);');
    expect(SOURCE).toContain('accessibilityLabel={`Vehicle: ${runnerVehicle}`}');
  });
});
