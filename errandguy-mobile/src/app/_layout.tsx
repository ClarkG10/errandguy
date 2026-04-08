import { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Montserrat_400Regular,
  Montserrat_700Bold,
} from '@expo-google-fonts/montserrat';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuthStore } from '../stores/authStore';
import { userService } from '../services/user.service';
import '../global.css';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Montserrat_400Regular,
    Montserrat_700Bold,
  });

  const { isAuthenticated, isLoading, role, token, loadFromStorage, setUser, logout } =
    useAuthStore();
  const segments = useSegments();
  const router = useRouter();

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

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/welcome');
    } else if (isAuthenticated && inAuthGroup) {
      if (role === 'runner') {
        router.replace('/(runner)/(tabs)');
      } else {
        router.replace('/(customer)/(tabs)');
      }
    }
  }, [isAuthenticated, isLoading, role, segments, fontsLoaded, router]);

  if (!fontsLoaded || isLoading) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Slot />
    </GestureHandlerRootView>
  );
}
