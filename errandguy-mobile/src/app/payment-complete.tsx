import { useCallback, useEffect } from 'react';
import { View, Text, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../stores/authStore';
import { LightColors } from '../constants/colors';

/**
 * Landing route for the payment return deep link (errandguy://payment-complete).
 *
 * Normally the in-app checkout sheet intercepts this URL and closes itself, and
 * the calling screen handles navigation — so this route isn't reached. But when
 * the checkout ran in the SYSTEM browser (a build without the expo-web-browser
 * native module), the OS deep-links back into the app instead, and without this
 * route expo-router shows "unmatched route //payment-complete". This catches it
 * and bounces the customer back to a sensible place. Balances / booking status
 * update via the Xendit webhook regardless.
 *
 * The return URL carries NO status (browser.ts PAYMENT_RETURN_URL is a bare
 * scheme, and this route is only reached on the system-browser fallback which
 * returns 'opened' — outcome unknowable). It is reached for EVERY return —
 * success, cancel, or failure alike — so this screen must NOT assert success.
 * The state is honest-neutral: we're finishing up, and the webhook is the real
 * source of truth for the balance.
 */
export default function PaymentComplete() {
  const router = useRouter();
  // Runners land here too (e.g. after authorizing a linked e-wallet from a
  // payments flow) — sending them to the customer tabs stranded them in the
  // wrong role's navigator. Route by the authenticated role instead.
  const role = useAuthStore((s) => s.role);

  const goHome = useCallback(() => {
    if (role === 'runner') {
      router.replace('/(runner)/(tabs)');
    } else {
      router.replace('/(customer)/(tabs)');
    }
  }, [role, router]);

  useEffect(() => {
    const t = setTimeout(goHome, 1200);
    return () => clearTimeout(t);
  }, [goHome]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: LightColors.background,
        padding: 24,
      }}
    >
      {/* Light canvas — force dark status-bar glyphs so they don't inherit a
          light-content bar from the screen we returned from. */}
      <StatusBar barStyle="dark-content" />

      {/* Neutral loader, not a success check: this screen can't confirm the
          payment outcome (webhook is the source of truth), so it must not
          claim success with a green check + celebratory haptic. */}
      <Spinner kind="brand" size={12} color={LightColors.primary} />
      <Text
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
        style={{
          marginTop: 20,
          fontFamily: 'Quicksand_700Bold',
          fontSize: 16,
          color: LightColors.textPrimary,
        }}
      >
        Finishing up…
      </Text>
      <Text
        style={{
          marginTop: 4,
          fontFamily: 'Quicksand_500Medium',
          fontSize: 13,
          lineHeight: 20,
          color: LightColors.textSecondary,
          textAlign: 'center',
        }}
      >
        Returning you to ErrandGuy — your balance updates once payment is
        confirmed.
      </Text>

      {/* Manual escape route so a stalled auto-redirect is never a dead end.
          Clamp the width so the CTA doesn't stretch edge-to-edge on a tablet. */}
      <View
        style={{
          marginTop: 32,
          width: '100%',
          maxWidth: 360,
          alignSelf: 'center',
          paddingHorizontal: 8,
        }}
      >
        <Button title="Continue" onPress={goHome} fullWidth />
      </View>
    </View>
  );
}
