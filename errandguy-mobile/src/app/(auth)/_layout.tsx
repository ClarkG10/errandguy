import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { STACK_ANIMATION } from '../../constants/navigation';

export default function AuthLayout() {
  return (
    <>
      {/* Every auth screen is a light surface; hoisting the barStyle here
          (instead of per-screen <StatusBar>) stops a previous route's
          light-content from leaking onto the six screens that never set
          one. */}
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: STACK_ANIMATION,
        }}
      />
    </>
  );
}
