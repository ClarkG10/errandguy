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
import { Platform } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import * as NavigationBar from 'expo-navigation-bar';
import { useAuthStore } from '../stores/authStore';
import { userService } from '../services/user.service';
import { useNotifications } from '../hooks/useNotifications';
import { ToastProvider } from '../components/ui/ToastProvider';
import '../../global.css';

// Initialize Mapbox
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '');

// Hide Android system navigation bar (immersive mode — swipe up to reveal)
if (Platform.OS === 'android') {
  NavigationBar.setVisibilityAsync('hidden');
  NavigationBar.setBehaviorAsync('overlay-swipe');
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

  const { isAuthenticated, isLoading, role, token, onboardingSeen, loadFromStorage, setUser, logout } =
    useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  // Register push notifications and FCM token
  useNotifications(isAuthenticated);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

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
    const currentAuthScreen = segments[1] as string;

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
        <ToastProvider />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
