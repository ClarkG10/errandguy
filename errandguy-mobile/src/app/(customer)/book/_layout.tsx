import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { STACK_ANIMATION } from '../../../constants/navigation';
import { useAuthStore } from '../../../stores/authStore';
import { prefetchWalletSummary } from '../../../services/preload.service';

export default function BookFlowLayout() {
  const userId = useAuthStore((s) => s.user?.id);

  // Every way into the funnel mounts this layout, so this is where the Review
  // screen's payment selector gets its wallet balance warmed (best-effort).
  useEffect(() => {
    if (userId) prefetchWalletSummary(userId);
  }, [userId]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: STACK_ANIMATION,
      }}
    >
      <Stack.Screen name="type" />
      <Stack.Screen name="details" />
      <Stack.Screen name="schedule" />
      <Stack.Screen name="review" />
      {/* iOS edge-swipe would silently abandon the live searching screen
          (the draft is already cleared at submit); cancellation must go
          through the explicit Cancel button. Android back is guarded
          in-screen via useBackGuard. */}
      <Stack.Screen name="confirm" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
