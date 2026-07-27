import { useEffect } from 'react';
import * as Updates from 'expo-updates';
import { APP_CONFIG } from '../constants/config';
import { toast } from '../stores/toastStore';
import { updates, useUpdateStore } from '../stores/updateStore';

/**
 * In-app OTA updates (EAS Update).
 *
 * - `checkForOtaUpdate({ silent })` is the core routine, callable from anywhere
 *   (settings row, launch effect). It checks → downloads → then either applies
 *   on next launch (non-critical) or hands off to <OtaUpdateGate/> (critical).
 * - `useOtaLaunchCheck(enabled)` fires one silent check per cold launch.
 *
 * All of this is inert in dev / Expo Go (`__DEV__` or `!Updates.isEnabled`),
 * where `checkForUpdateAsync` would throw.
 */

/**
 * Read the `ota.critical` flag we bake into the update's `extra` at publish
 * time (via app.config.js + EXPO_OTA_CRITICAL=1). EAS Update surfaces app
 * config `extra` at `manifest.extra.expoClient.extra`; classic manifests use
 * `manifest.extra`. Check both shapes defensively.
 */
function readCritical(manifest: unknown): boolean {
  try {
    const m = manifest as {
      extra?: { ota?: { critical?: boolean }; expoClient?: { extra?: { ota?: { critical?: boolean } } } };
    } | null;
    return Boolean(m?.extra?.expoClient?.extra?.ota?.critical ?? m?.extra?.ota?.critical ?? false);
  } catch {
    return false;
  }
}

export async function checkForOtaUpdate({ silent }: { silent: boolean }): Promise<void> {
  // OTA only works in a real build with updates enabled — never in dev/Expo Go.
  if (__DEV__ || !Updates.isEnabled) {
    if (!silent) toast.info('Updates are only available in an installed build.');
    return;
  }

  const current = useUpdateStore.getState().status;
  if (current === 'checking' || current === 'downloading') return;

  updates.set({ status: 'checking' });

  try {
    const result = await Updates.checkForUpdateAsync();
    updates.set({ lastCheckedAt: Date.now() });

    if (!result.isAvailable) {
      updates.set({ status: 'upToDate' });
      if (!silent) toast.success("You're on the latest version.");
      return;
    }

    const mandatory = readCritical(result.manifest);
    updates.set({ status: 'downloading', isMandatory: mandatory });

    await Updates.fetchUpdateAsync();
    updates.set({ status: 'downloaded', isMandatory: mandatory });

    if (mandatory) {
      // <OtaUpdateGate/> is mounted globally and will block the app on the
      // downloaded critical update until the user restarts.
      return;
    }

    // Non-critical: the downloaded update applies automatically on the next
    // cold launch. Offer an instant restart via a toast action.
    const applyNow = () => {
      void Updates.reloadAsync();
    };
    if (silent) {
      toast.info('A new update is ready.', { actionLabel: 'Restart', onAction: applyNow });
    } else {
      toast.success('Update downloaded.', { actionLabel: 'Restart now', onAction: applyNow });
    }
  } catch {
    updates.set({ status: 'error' });
    if (!silent) toast.error('Could not check for updates. Please try again.');
  }
}

/** Fire one silent OTA check per cold launch (used by the root layout). */
export function useOtaLaunchCheck(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !APP_CONFIG.OTA_CHECK_ON_LAUNCH) return;
    void checkForOtaUpdate({ silent: true });
    // Intentionally runs once when `enabled` flips true (post-bootstrap).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
