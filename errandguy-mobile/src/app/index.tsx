import { useEffect, useState } from 'react';
import { View, Image, StatusBar } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '../stores/authStore';
import { LightColors } from '../constants/colors';

/**
 * Branded hold shown while an authenticated cold start is still resolving the
 * role. Mirrors the native splash (same background + centered logo) so the
 * handoff from the OS splash to this frame is seamless — no color pop, no
 * flash of the wrong navigator.
 */
function BrandedSplash() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: LightColors.background,
      }}
    >
      {/* Light canvas — force dark status-bar glyphs so the OS bar stays legible
          during the branded hold (edge-to-edge Android otherwise paints light
          glyphs that vanish on the #F7F8FA band). Mirrors payment-complete. */}
      <StatusBar barStyle="dark-content" />
      <Image
        source={require('../../assets/logo-new.png')}
        resizeMode="contain"
        style={{ width: 180, height: 180 }}
        accessibilityLabel="ErrandGuy"
      />
    </View>
  );
}

export default function Index() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  const user = useAuthStore((s) => s.user);
  const onboardingSeen = useAuthStore((s) => s.onboardingSeen);

  // Safety net for the branded hold below: on an offline / failed cold start
  // the profile fetch never resolves the role, so don't wait on the splash
  // forever. After a short grace period fall through to a default navigator;
  // the group layouts self-correct to the right role once the profile loads.
  const [graceElapsed, setGraceElapsed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGraceElapsed(true), 3000);
    return () => clearTimeout(t);
  }, []);

  if (!isAuthenticated) {
    // Single source of truth with _layout's redirect effect: returning
    // (onboarded) users land on login, first-run users see the welcome
    // carousel. Keeping these in sync stops the two authorities from racing
    // a returning user onto the onboarding carousel.
    return <Redirect href={onboardingSeen ? '/(auth)/login' : '/(auth)/welcome'} />;
  }

  if (role === 'runner') {
    return <Redirect href="/(runner)/(tabs)" />;
  }

  if (role === 'customer') {
    return <Redirect href="/(customer)/(tabs)" />;
  }

  // Authenticated but the role STILL isn't known. loadFromStorage now
  // rehydrates the persisted boot snapshot ({id, role, …}) before `isLoading`
  // flips, so a returning user normally hits one of the two redirects above on
  // frame one and never reaches here. This path is what's left: a first launch
  // after sign-up, an install upgraded from a build that predates the snapshot,
  // or a purged one — the role only arrives with the /user/profile fetch.
  // Redirecting on the null role would drop a runner into the CUSTOMER
  // navigator for a beat (wrong tabs + stray customer fetches) before it
  // bounced back, so branch on what we actually know:
  if (user) {
    // Profile loaded but still role-less — the account finished OTP without
    // choosing a role. Continue registration instead of stranding the splash.
    return <Redirect href="/(auth)/role-select" />;
  }

  if (graceElapsed) {
    // Role never resolved (offline / failed fetch). Fall back to the default
    // navigator; the (customer)/(runner) layouts redirect by role once it loads.
    return <Redirect href="/(customer)/(tabs)" />;
  }

  // Role still resolving — hold on the branded splash rather than flashing
  // the wrong navigator.
  return <BrandedSplash />;
}
