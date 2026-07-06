import { useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
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
 */
export default function PaymentComplete() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => {
      router.replace('/(customer)/(tabs)');
    }, 700);
    return () => clearTimeout(t);
  }, [router]);

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
      <ActivityIndicator color={LightColors.primary} />
      <Text
        style={{
          marginTop: 14,
          fontFamily: 'Quicksand_700Bold',
          fontSize: 16,
          color: LightColors.textPrimary,
        }}
      >
        Payment received
      </Text>
      <Text
        style={{
          marginTop: 4,
          fontFamily: 'Quicksand_500Medium',
          fontSize: 13,
          color: LightColors.textSecondary,
          textAlign: 'center',
        }}
      >
        Returning you to ErrandGuy… your balance updates once it’s confirmed.
      </Text>
    </View>
  );
}
