import { Stack } from 'expo-router';

export default function ChatLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'ios_from_right' }} />;
}
