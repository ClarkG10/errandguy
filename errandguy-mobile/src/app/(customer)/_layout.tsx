import { useEffect } from 'react';
import { Slot, useRouter } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';

export default function CustomerLayout() {
  const { isAuthenticated, role } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/(auth)/welcome');
    } else if (role === 'runner') {
      router.replace('/(runner)/(tabs)');
    }
  }, [isAuthenticated, role, router]);

  if (!isAuthenticated || role === 'runner') {
    return null;
  }

  return <Slot />;
}
