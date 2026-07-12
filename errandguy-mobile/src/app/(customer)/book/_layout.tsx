import { Stack } from 'expo-router';
import { STACK_ANIMATION } from '../../../constants/navigation';

export default function BookFlowLayout() {
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
