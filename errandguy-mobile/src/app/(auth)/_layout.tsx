import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { STACK_ANIMATION } from '../../constants/navigation';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/toastStore';

export default function AuthLayout() {
  // The api interceptor ends the session when the ACCOUNT itself is dead
  // (suspended / banned / deleted). Explain that once, here — being thrown out
  // of the app with no reason is indistinguishable from a bug, and retrying is
  // the only thing left to try.
  //
  // Announced from the auth LAYOUT rather than the login screen because the
  // root gate picks the landing screen by `onboardingSeen` (login or welcome);
  // this covers both. Read-and-clear, so it can never resurface after an
  // ordinary sign-out later.
  useEffect(() => {
    const reason = useAuthStore.getState().consumeSessionEndedReason();
    if (reason) toast.error(reason);
  }, []);

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
