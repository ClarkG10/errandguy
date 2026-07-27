import * as Application from 'expo-application';
import * as Updates from 'expo-updates';

/**
 * Human-readable app version for settings screens, e.g. "1.0.0" or, when a JS
 * OTA update is running on top of the native binary, "1.0.0 · 3f2a9c1b".
 * The short update-id suffix lets QA confirm which OTA bundle is live.
 */
export function getAppVersionLabel(): string {
  const version = Application.nativeApplicationVersion ?? '—';
  try {
    if (Updates.isEnabled && !Updates.isEmbeddedLaunch && Updates.updateId) {
      return `${version} · ${Updates.updateId.slice(0, 8)}`;
    }
  } catch {
    // Constants unavailable (e.g. dev) — fall through to the bare version.
  }
  return version;
}
