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
      <Stack.Screen name="confirm" />
    </Stack>
  );
}
