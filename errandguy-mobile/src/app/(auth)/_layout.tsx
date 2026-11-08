import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { STACK_ANIMATION } from '../../constants/navigation';
import { useAuthStore } from '../../stores/authStore';
import { useBookingStore } from '../../stores/bookingStore';
import { toast } from '../../stores/toastStore';
import { SIGNED_OUT_REASON } from '../../services/api';
import { SessionExpiredModal, hasBookingDraft } from '../../components/auth/SessionExpiredModal';

export default function AuthLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [sessionExpired, setSessionExpired] = useState<{ draftSaved: boolean } | null>(null);

  // The api interceptor ends the session — and says why — in two cases:
  //   • a 401 for the token in use (SIGNED_OUT_REASON): the session expired
  //     or was revoked. Pattern 8: a calm card over the dimmed sign-in screen
  //     that says so and, when a booking draft survived (the 401 path never
  //     wipes it), that the draft is saved.
  //   • the ACCOUNT itself is dead (suspended / banned / deleted): the
  //     server's own message, as a toast — retrying is the only thing left.
  // Being thrown out of the app with no reason is indistinguishable from a bug.
  //
  // Announced from the auth LAYOUT rather than the login screen because the
  // root gate picks the landing screen by `onboardingSeen` (login or welcome);
  // this covers both. Read-and-clear, so it can never resurface after an
  // ordinary sign-out later.
  useEffect(() => {
    const reason = useAuthStore.getState().consumeSessionEndedReason();
    if (!reason) return;
    if (reason !== SIGNED_OUT_REASON) {
      toast.error(reason);
      return;
    }
    let cancelled = false;
    const bookings = useBookingStore.getState();
    // A cold start straight into a 401 may not have read the draft yet.
    const hydrated = bookings.isDraftHydrated
      ? Promise.resolve()
      : bookings.loadDraftFromStorage().catch(() => {});
    hydrated.then(() => {
      if (cancelled) return;
      setSessionExpired({ draftSaved: hasBookingDraft(useBookingStore.getState().draftBooking) });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleContinue = () => {
    setSessionExpired(null);
    // Welcome is the landing screen for someone who never finished
    // onboarding; signing back in happens on login.
    const onLogin = segments[segments.length - 1] === 'login';
    if (!onLogin) router.replace('/(auth)/login');
  };

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
      <SessionExpiredModal
        visible={!!sessionExpired}
        draftSaved={!!sessionExpired?.draftSaved}
        onContinue={handleContinue}
      />
    </>
  );
}
