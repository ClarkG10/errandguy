import { useLocationStore } from '../stores/locationStore';
import { useRunnerStore } from '../stores/runnerStore';

/**
 * Leave runner mode on this phone: GPS watch, idle heartbeat and resume-ping
 * off, then the runner store back to its signed-out shape.
 *
 * Every way out of runner mode needs it — signing out, a session the server
 * ended, a different account signing in, switching to customer mode. None of
 * them used to stop tracking: the watch and the once-a-minute heartbeat kept
 * posting the location with a token that was revoked or gone (a stream of
 * 401/403s, each one re-running the session teardown), and a runner who
 * switched to customer mode carried a live GPS fix around all day.
 *
 * Order matters: tracking stops FIRST. The location store re-arms its watch
 * whenever the runner's current errand appears or disappears, so clearing the
 * errand while the watch was still live would restart the very GPS this is
 * meant to stop. Idempotent, synchronous, never throws.
 */
export function stopRunnerActivity(): void {
  try {
    useLocationStore.getState().stopTracking();
  } catch {
    // A native watch that won't detach must not block a sign-out.
  }
  useRunnerStore.getState().reset();
}
