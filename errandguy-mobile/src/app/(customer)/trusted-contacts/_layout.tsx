import { Stack } from 'expo-router';
import { STACK_ANIMATION } from '../../../constants/navigation';

export default function TrustedContactsLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: STACK_ANIMATION }} />;
}
