import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Fingerprint, ScanFace } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

/** Human name for the device's biometric technology — for UI copy like
 *  "Unlock with Face ID" that would read wrong on fingerprint devices. */
export type BiometricLabel = 'Face ID' | 'Touch ID' | 'Fingerprint' | 'Biometrics';

/**
 * Wraps expo-local-authentication for Face ID / Touch ID / fingerprint
 * unlock on the login screen.
 *
 * `available` is true only when the device HAS biometric hardware AND
 * the user has ENROLLED at least one biometric — anything less means we
 * must fall back to password login. Both probes are wrapped so a missing
 * native module (Expo Go / a dev client that hasn't been rebuilt after
 * adding the dependency) degrades to "unavailable" instead of crashing.
 *
 * Also probes supportedAuthenticationTypesAsync so callers can name the
 * actual technology (`biometricLabel`) and show a matching glyph
 * (`biometricIcon`) instead of hardcoding "Face ID"/ScanFace on Touch ID
 * iPhones and Android fingerprint devices.
 *
 * NOTE: This feature requires a native rebuild (`npx expo prebuild` +
 * pod install / gradle). In Expo Go the native module is absent and
 * `available` resolves to false.
 */
export function useBiometricUnlock() {
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  // Single state object so label + icon never disagree mid-render.
  // Defaults match the pre-probe UI (Face ID copy + ScanFace glyph).
  const [tech, setTech] = useState<{ label: BiometricLabel; icon: LucideIcon }>({
    label: 'Biometrics',
    icon: ScanFace,
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [hasHardware, enrolled, types] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          LocalAuthentication.supportedAuthenticationTypesAsync().catch(
            () => [] as LocalAuthentication.AuthenticationType[],
          ),
        ]);
        if (mounted) {
          setAvailable(!!hasHardware && !!enrolled);
          const hasFace = types.includes(
            LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
          );
          const hasFinger = types.includes(
            LocalAuthentication.AuthenticationType.FINGERPRINT,
          );
          // "Face ID"/"Touch ID" are Apple trademarks — only use them on
          // iOS. Android face unlock has no universal brand name, so it
          // falls through to the generic "Biometrics".
          let label: BiometricLabel = 'Biometrics';
          if (Platform.OS === 'ios' && hasFace) label = 'Face ID';
          else if (Platform.OS === 'ios' && hasFinger) label = 'Touch ID';
          else if (hasFinger) label = 'Fingerprint';
          setTech({
            label,
            icon: label === 'Face ID' || (hasFace && !hasFinger) ? ScanFace : Fingerprint,
          });
        }
      } catch {
        if (mounted) setAvailable(false);
      } finally {
        if (mounted) setChecking(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  /**
   * Present the system biometric prompt. Resolves `true` only on a
   * confirmed success; a cancel, lockout, or missing module resolves
   * `false` so the caller can fall back to password login.
   */
  const authenticate = useCallback(
    async (promptMessage = 'Unlock ErrandGuy'): Promise<boolean> => {
      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage,
          cancelLabel: 'Use password',
          // Allow the device passcode as a fallback so a failed face
          // scan doesn't dead-end the user.
          disableDeviceFallback: false,
        });
        return result.success;
      } catch {
        return false;
      }
    },
    [],
  );

  return {
    available,
    checking,
    authenticate,
    biometricLabel: tech.label,
    biometricIcon: tech.icon,
  };
}
