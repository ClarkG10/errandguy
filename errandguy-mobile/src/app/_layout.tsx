import { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { GoogleSans_400Regular } from '@expo-google-fonts/google-sans/400Regular';
import { GoogleSans_500Medium } from '@expo-google-fonts/google-sans/500Medium';
import { GoogleSans_600SemiBold } from '@expo-google-fonts/google-sans/600SemiBold';
import { GoogleSans_700Bold } from '@expo-google-fonts/google-sans/700Bold';
import { Montserrat_300Light } from '@expo-google-fonts/montserrat/300Light';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
import { Platform, LogBox, StatusBar } from 'react-native';
import { useAuthStore } from '../stores/authStore';
import { useBookingStore } from '../stores/bookingStore';
import { usePaymentStore } from '../stores/paymentStore';
import { useNetworkStore } from '../stores/networkStore';
import { userService } from '../services/user.service';
import { preloadAfterAuth, preloadCoreImages } from '../services/preload.service';
import { initMutationQueue } from '../services/mutationQueue';
import { useNotifications } from '../hooks/useNotifications';
import { useOtaLaunchCheck } from '../hooks/useOtaUpdate';
import { ToastProvider } from '../components/ui/ToastProvider';
import { OtaUpdateGate } from '../components/ui/OtaUpdateGate';
import { WhatsNewSheet } from '../components/ui/WhatsNewSheet';
import { ApiActivityBar } from '../components/ui/ApiActivityBar';
import { OfflineBanner } from '../components/ui/OfflineBanner';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { installErrorLogging } from '../utils/errorLogging';
import '../../global.css';

// Surface uncaught JS errors + unhandled promise rejections clearly in the
// `npx expo start` terminal so crashes are diagnosable at a glance. Runs at
// module load, before any screen mounts. See utils/errorLogging.ts.
installErrorLogging();

// Suppress known third-party / native-module-not-linked warnings so the
// dev console isn't flooded on every hot-reload. These are all expected
// in Expo Go / dev-client builds where native modules aren't fully linked.
LogBox.ignoreLogs([
  // SafeAreaView from `react-native` core is deprecated; our code already
  // uses react-native-safe-area-context, but some third-party packages don't.
  'SafeAreaView has been deprecated',
  // expo-linear-gradient ViewManager isn't registered in Expo Go or a
  // dev-client that hasn't been rebuilt after adding the module.
  'Unable to get the view config for',
  // Logged by our own try/catch below when expo-navigation-bar isn't linked.
  '[ExpoNavigationBar]',
]);

// Google Maps API key is configured via EXPO_PUBLIC_GOOGLE_MAPS_KEY in app.json/eas.json

// UI text renders in Google Sans via load-time font aliasing in RootLayout's
// useFonts() call — the loaded Google Sans TTFs are also registered under the
// legacy Quicksand_*/Inter_* family names the codebase still references.

// FONT SCALING — deliberately NOT locked here. Read src/constants/fontScale.ts
// before adding anything back.
//
// This block used to read:
//
//   Text.defaultProps.allowFontScaling = false;
//   TextInput.defaultProps.maxFontSizeMultiplier = 1;
//
// intending to freeze the app at one physical size on both platforms. It had
// stopped working: React 19 no longer resolves `defaultProps` on function
// components, this project compiles JSX with the automatic runtime, and RN's
// `Text` is a function component — so the assignment applied to nothing. (Only
// the legacy `React.createElement` path still honours `defaultProps`, so a few
// third-party libraries were locked while the entire app scaled — the opposite
// of the cross-platform parity the code claimed.) It was invisible because
// react-native's jest setup replaces `Text` with a CLASS mock, where
// `defaultProps` still resolves.
//
// The decision, made explicit rather than left accidental: OS text scaling
// STAYS ON — it is the single highest-frequency accessibility accommodation
// there is — and layout is protected per component with an explicit
// `maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}` on fixed-height chrome
// (Button, Typography, ToastProvider, Input, PaymentProgress and the tracking
// screen already do this). Body copy stays uncapped so it can grow and wrap.
//
// Deleting these lines changes NOTHING at runtime; they were already inert.
// `src/constants/__tests__/fontScale.test.tsx` pins that fact so the dead
// pattern cannot come back mistaken for a working lock.

// Hide Android system navigation bar (immersive mode — swipe up to reveal).
// `expo-navigation-bar` ships a native module that may be missing in some
// development builds (Expo Go, prebuild-out-of-sync); lazy-require so the
// entire app doesn't fail to boot when it isn't linked.
if (Platform.OS === 'android') {
  try {
    const NavigationBar = require('expo-navigation-bar');
    NavigationBar.setVisibilityAsync('hidden');
    NavigationBar.setBehaviorAsync('overlay-swipe');
  } catch {
    // Native module not linked (Expo Go / out-of-sync dev client) — safe to ignore.
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
    GoogleSans_400Regular,
    GoogleSans_500Medium,
    GoogleSans_600SemiBold,
    GoogleSans_700Bold,
    Montserrat_300Light,
    // Alias the loaded Google Sans TTFs under the legacy Quicksand_* / Inter_*
    // family names still used across the codebase — both via NativeWind
    // `font-*` classes (tailwind.config maps them to Quicksand_*) and inline
    // `fontFamily: 'Quicksand_700Bold'` StyleSheet literals. Registering the
    // real font under those names makes RN's font resolver map them straight
    // to Google Sans, so every screen renders in the intended face without a
    // render-time remap. Same TTF pointed at multiple family names is fine.
    Quicksand_400Regular: GoogleSans_400Regular,
    Quicksand_500Medium: GoogleSans_500Medium,
    Quicksand_600SemiBold: GoogleSans_600SemiBold,
    Quicksand_700Bold: GoogleSans_700Bold,
    Inter_400Regular: GoogleSans_400Regular,
    Inter_500Medium: GoogleSans_500Medium,
    Inter_600SemiBold: GoogleSans_600SemiBold,
    Inter_700Bold: GoogleSans_700Bold,
    // Preload the Ionicons glyph font used by the tab bars so the icons
    // paint on first render instead of flashing in a frame later.
    ...Ionicons.font,
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
  // Rehydrate any in-flight payment attempt BEFORE any screen (incl. the
  // payment-complete deep-link landing) reads it, so a mid-payment kill/return
  // resumes verification instead of stranding the user with no outcome.
  const loadPaymentAttempt = usePaymentStore((s) => s.loadFromStorage);
  const isOffline = useNetworkStore((s) => s.isOffline);
  const segments = useSegments();
  const router = useRouter();

  // Register push notifications + FCM token. Only do this once the
  // account has at least one verified contact channel — otherwise we'd
  // be requesting OS-level notification permission while the user is
  // still mid-OTP, which is jarring and degrades grant rates.
  const canRegisterPush =
    isAuthenticated && !!(user?.phone_verified || user?.email_verified);
  useNotifications(canRegisterPush);

  // Silently check for an OTA update once the app is past bootstrap. A
  // non-critical update downloads and applies on the next launch; a critical
  // one is force-applied via <OtaUpdateGate/>. No-op in dev / Expo Go.
  useOtaLaunchCheck(!isLoading);

  useEffect(() => {
    loadFromStorage();
    loadDraftFromStorage();
    loadPaymentAttempt();
    preloadCoreImages();
    // Rehydrate any offline-queued mutations and wire the reconnect flush so
    // changes made while offline sync themselves the moment we're back online.
    void initMutationQueue();
  }, [loadFromStorage, loadDraftFromStorage, loadPaymentAttempt]);

  // Validate token on app load
  useEffect(() => {
    if (isLoading || !token) return;

    // Abort the in-flight profile call if the layout unmounts (hot
    // reload / fast logout / token swap) so we don't end up with a
    // stale `setUser` racing the new state \u2014 and so we don't burn
    // the network call on a result nobody will read.
    const controller = new AbortController();
    let cancelled = false;

    const validateSession = async () => {
      try {
        const response = await userService.getProfile({ signal: controller.signal });
        if (cancelled) return;
        const fresh = response.data.data ?? response.data;
        setUser(fresh);
        // Warm critical caches so the first tab the user lands on
        // paints from cache instead of showing a skeleton.
        preloadAfterAuth(fresh?.role ?? null, fresh?.id);
      } catch (err: any) {
        if (cancelled || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
        // Only treat a definitive auth rejection as an invalid session.
        // A transport-level failure (offline cold start, flaky network)
        // or a server hiccup must NOT log the user out; keep the cached
        // session and let the next successful request refresh the profile.
        // NOTE: the api.ts interceptor normalizes every rejection to a
        // flat { status, message, errors } object (status:0 for network
        // errors) — there is no axios-style `.response` here, so we read
        // `err.status` directly.
        const status = err?.status;
        if (status === 401 || status === 403) {
          await logout();
        }
      }
    };

    validateSession();

    return () => {
      cancelled = true;
      controller.abort();
    };
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
        {/* Only assert a global bar style while the dark offline banner covers
            the status-bar area — light-content glyphs stay legible on the ink
            band. Mounted conditionally so per-screen StatusBars (GradientHeader)
            own the bar the rest of the time; unmounting restores their style. */}
        {isOffline && <StatusBar barStyle="light-content" />}
        {/* Catch render crashes in the navigator tree and show a recoverable
            full-screen error instead of a white screen / bare redbox. The
            app-chrome overlays below stay outside the boundary so a crashed
            screen doesn't take the toast / offline banner down with it. */}
        <ErrorBoundary>
          <Slot />
        </ErrorBoundary>
        <ApiActivityBar />
        <OfflineBanner />
        <ToastProvider />
        {/* Blocking gate for a critical OTA update (invisible otherwise). */}
        <OtaUpdateGate />
        {/* Once-per-release "What's New" changelog after a non-critical OTA
            swap. Self-gating — renders null until the runtime version changes.
            Never blocks launch. */}
        <WhatsNewSheet />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
