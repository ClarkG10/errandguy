import { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import {
  Quicksand_400Regular,
  Quicksand_500Medium,
  Quicksand_600SemiBold,
  Quicksand_700Bold,
} from '@expo-google-fonts/quicksand';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
import { Platform, Text, TextInput } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { useAuthStore } from '../stores/authStore';
import { useBookingStore } from '../stores/bookingStore';
import { userService } from '../services/user.service';
import { useNotifications } from '../hooks/useNotifications';
import { ToastProvider } from '../components/ui/ToastProvider';
import { ApiActivityBar } from '../components/ui/ApiActivityBar';
import { applySystemFontOnIOS } from '../utils/systemFont';
import '../../global.css';

// Initialize Mapbox
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '');

// On iOS, render all text with San Francisco (SF Pro) by remapping the
// Quicksand/Inter family names to `System` + an explicit fontWeight.
applySystemFontOnIOS();

// Lock font scaling globally so the app renders at the same physical
// size on iOS and Android regardless of the OS-level "Display size" /
// "Font size" accessibility settings. Without this, Android with a
// large display setting renders every label, button, and tab item ~1.3x
// larger than iOS — which is what the user was complaining about.
// Suppression is set on the component defaultProps before any screen
// mounts, so it cascades through the whole tree.
// @ts-expect-error - defaultProps exists at runtime on RN base components
Text.defaultProps = Text.defaultProps ?? {};
// @ts-expect-error
Text.defaultProps.allowFontScaling = false;
// @ts-expect-error
TextInput.defaultProps = TextInput.defaultProps ?? {};
// @ts-expect-error
TextInput.defaultProps.allowFontScaling = false;
// @ts-expect-error
TextInput.defaultProps.maxFontSizeMultiplier = 1;

// Hide Android system navigation bar (immersive mode — swipe up to reveal).
// `expo-navigation-bar` ships a native module that may be missing in some
// development builds (Expo Go, prebuild-out-of-sync); lazy-require so the
// entire app doesn't fail to boot when it isn't linked.
if (Platform.OS === 'android') {
  try {
    const NavigationBar = require('expo-navigation-bar');
    NavigationBar.setVisibilityAsync('hidden');
    NavigationBar.setBehaviorAsync('overlay-swipe');
  } catch (e) {
    if (__DEV__) {
      console.warn('[ExpoNavigationBar] native module unavailable — skipping immersive setup');
    }
  }
}

// Prevent ExpoKeepAwake.activate crash when activity is destroyed
if (__DEV__ && Platform.OS !== 'web') {
  const { deactivateKeepAwake } = require('expo-keep-awake');
  deactivateKeepAwake();
}

// Disable Reanimated strict mode — css-interop reads shared values during render
configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Quicksand_400Regular,
    Quicksand_500Medium,
    Quicksand_600SemiBold,
    Quicksand_700Bold,
  });

  // Use individual selectors to avoid re-rendering the whole tree (and
  // re-firing the validateSession effect) on every unrelated zustand
  // update. Destructuring `useAuthStore()` returns a fresh object snapshot
  // on every render, which made `setUser` / `logout` look "new" and
  // re-triggered the /user/profile fetch on every render.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const role = useAuthStore((s) => s.role);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const onboardingSeen = useAuthStore((s) => s.onboardingSeen);
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  // Hydrate any in-flight booking draft (item description, locations,
  // photos, etc.) so a crash, kill, or OS-eviction during the booking
  // funnel doesn't lose the user's typing.
  const loadDraftFromStorage = useBookingStore((s) => s.loadDraftFromStorage);
  const segments = useSegments();
  const router = useRouter();

  // Register push notifications + FCM token. Only do this once the
  // account has at least one verified contact channel — otherwise we'd
  // be requesting OS-level notification permission while the user is
  // still mid-OTP, which is jarring and degrades grant rates.
  const canRegisterPush =
    isAuthenticated && !!(user?.phone_verified || user?.email_verified);
  useNotifications(canRegisterPush);

  useEffect(() => {
    loadFromStorage();
    loadDraftFromStorage();
  }, [loadFromStorage, loadDraftFromStorage]);

  // Validate token on app load
  useEffect(() => {
    if (isLoading || !token) return;

    const validateSession = async () => {
      try {
        const response = await userService.getProfile();
        setUser(response.data.data ?? response.data);
      } catch {
        await logout();
      }
    };

    validateSession();
  }, [isLoading, token, setUser, logout]);

  useEffect(() => {
    if (fontsLoaded && !isLoading) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, isLoading]);

  useEffect(() => {
    if (isLoading || !fontsLoaded) return;

    const inAuthGroup = segments[0] === '(auth)';
    // Cast through unknown — expo-router strictly types segments as
    // single-element tuples for top-level groups even though the runtime
    // value is the full path.
    const currentAuthScreen = ((segments as unknown as string[])[1] ?? '') as string;

    // Screens authenticated users must stay on to finish registration
    const registrationFlowScreens = ['register', 'verify-otp', 'role-select', 'permissions', 'contacts-permission'];

    if (!isAuthenticated && !inAuthGroup) {
      // Skip onboarding carousel for returning users
      if (onboardingSeen) {
        router.replace('/(auth)/login');
      } else {
        router.replace('/(auth)/welcome');
      }
    } else if (isAuthenticated && inAuthGroup) {
      // Let user finish registration flow before redirecting to home
      if (!registrationFlowScreens.includes(currentAuthScreen)) {
        if (role === 'runner') {
          router.replace('/(runner)/(tabs)');
        } else {
          router.replace('/(customer)/(tabs)');
        }
      }
    }
  }, [isAuthenticated, isLoading, role, segments, fontsLoaded, onboardingSeen, router]);

  if (!fontsLoaded || isLoading) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Slot />
        <ApiActivityBar />
        <ToastProvider />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
