import { Stack } from 'expo-router';
import { STACK_ANIMATION } from '../../../constants/navigation';

export default function RunnerChatLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: STACK_ANIMATION }} />;
}
