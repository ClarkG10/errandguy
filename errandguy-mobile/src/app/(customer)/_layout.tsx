import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';
import { useRealtimeNotifications } from '../../hooks/useRealtimeNotifications';

export default function CustomerLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  // Subscribe to realtime notifications for the current user
  useRealtimeNotifications(user?.id ?? null);

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

  // Use Stack (not Slot) so router.back() pops to the previous screen
  // within this group (e.g. Profile → Wallet → back returns to Profile,
  // not to the home tab the user happened to visit earlier).
  return <Stack screenOptions={{ headerShown: false, animation: 'ios_from_right' }} />;
}
