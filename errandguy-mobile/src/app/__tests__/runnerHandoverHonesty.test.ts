import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Found by walking a real cash errand end to end (2026-11-08). The runner
 * cockpit can't be rendered under jest (maps, router, sockets), so — like
 * runnerJourneyConvenience — the fixes are pinned against the source.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const COCKPIT = stripComments(
  readFileSync(join(__dirname, '..', '(runner)', 'errand', '[id].tsx'), 'utf8'),
);

describe('the runner cockpit at the handover', () => {
  it('does not say the errand is complete while the cash and signature are still to come', () => {
    // At `delivered` the headline read "Errand complete", and a runner could
    // walk away without collecting the fare.
    expect(COCKPIT).toMatch(/case 'delivered':\s*return 'Finish the handover';/);
    expect(COCKPIT).toMatch(/case 'completed':\s*return 'Errand complete';/);
  });

  it('closes the arrival prompt once the status it was raised for has moved on', () => {
    // Reopening an errand paints the cached (older) status first: the
    // detector fired, the fresh "already arrived" status loaded, and the
    // prompt stayed up offering to push the errand another step.
    expect(COCKPIT).toContain(
      'const showArrivalPrompt = arrivalPromptStatus !== null && arrivalPromptStatus === booking?.status;',
    );
    expect(COCKPIT).toContain('setArrivalPromptStatus(show ? arrivalStatusRef.current : null);');
    expect(COCKPIT).not.toMatch(/useState\(false\);\s*\n\s*const handleArrivalDetected/);
  });
});
