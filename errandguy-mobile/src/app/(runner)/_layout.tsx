import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';
import { useRealtimeNotifications } from '../../hooks/useRealtimeNotifications';

export default function RunnerLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const segments = useSegments();
  const [ready, setReady] = useState(false);

  // Subscribe to realtime notifications for the current user
  useRealtimeNotifications(user?.id ?? null);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/(auth)/welcome');
      return;
    }

    if (role === 'customer') {
      router.replace('/(customer)/(tabs)');
      return;
    }

    // Gate: redirect to onboarding if runner has no profile or no documents
    // (unless they explicitly skipped)
    const isOnboarding = segments.includes('onboarding' as never);
    const skipped = useAuthStore.getState().runnerOnboardingSkipped;
    if (!isOnboarding && !skipped) {
      const profile = user?.runner_profile;
      const hasDocuments =
        profile?.documents && profile.documents.length > 0;

      if (!profile || !hasDocuments) {
        router.replace('/(runner)/onboarding');
        return;
      }
    }

    setReady(true);
  }, [isAuthenticated, role, user, router, segments]);

  if (!isAuthenticated || role === 'customer') {
    return null;
  }

  // Show loading until navigation check completes — prevents tabs from fetching before redirect
  const isOnboarding = segments.includes('onboarding' as never);
  if (!ready && !isOnboarding) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return <Slot />;
}
