import { useEffect } from 'react';
import { Slot, useRouter } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';

export default function RunnerLayout() {
  const { isAuthenticated, role } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/(auth)/welcome');
    } else if (role === 'customer') {
      router.replace('/(customer)/(tabs)');
    }
  }, [isAuthenticated, role, router]);

  if (!isAuthenticated || role === 'customer') {
    return null;
  }

  return <Slot />;
}
