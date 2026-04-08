import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';

export default function AuthLayout() {
  const { isAuthenticated, role } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) {
      if (role === 'runner') {
        router.replace('/(runner)/(tabs)');
      } else {
        router.replace('/(customer)/(tabs)');
      }
    }
  }, [isAuthenticated, role, router]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    />
  );
}
