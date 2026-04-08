import { Stack } from 'expo-router';

export default function BookFlowLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
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
