import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';
import { useRealtimeNotifications } from '../../hooks/useRealtimeNotifications';
import { STACK_ANIMATION } from '../../constants/navigation';

export default function CustomerLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const segments = useSegments();

  // The threaded support surface (support/, support/[id]) is shared by both
  // roles: a runner reaching it from their Help screen must be allowed
  // through even though every OTHER (customer) route bounces runners back to
  // their own tabs. The root layout renders <Slot/>, so switching groups
  // unmounts the previous group — there is no concurrent double-mount of the
  // realtime notifications subscription to worry about.
  const inSharedSupport = (segments as unknown as string[]).includes('support');
  const runnerBounced = role === 'runner' && !inSharedSupport;

  // Subscribe to realtime notifications for the current user
  useRealtimeNotifications(user?.id ?? null);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/(auth)/welcome');
    } else if (runnerBounced) {
      router.replace('/(runner)/(tabs)');
    }
  }, [isAuthenticated, runnerBounced, router]);

  if (!isAuthenticated || runnerBounced) {
    return null;
  }

  // Use Stack (not Slot) so router.back() pops to the previous screen
  // within this group (e.g. Profile → Wallet → back returns to Profile,
  // not to the home tab the user happened to visit earlier).
  return <Stack screenOptions={{ headerShown: false, animation: STACK_ANIMATION }} />;
}
