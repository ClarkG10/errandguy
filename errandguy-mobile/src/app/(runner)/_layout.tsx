import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { CenteredLoader } from '@/components/ui/Spinner';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';
import { useRealtimeNotifications } from '../../hooks/useRealtimeNotifications';
import { STACK_ANIMATION } from '../../constants/navigation';

// The two documents a runner MUST upload before using the app — mirrors the
// `required: true` entries of REQUIRED_DOCUMENTS in onboarding.tsx (keep in
// sync). A type counts only when a doc of that type exists and isn't rejected,
// matching onboarding's isDocComplete — so a rejected runner is sent back to
// re-upload.
const REQUIRED_RUNNER_DOC_TYPES = ['government_id', 'selfie'] as const;

export default function RunnerLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const segments = useSegments();
  const [ready, setReady] = useState(false);

  // Subscribe to realtime notifications for the current user
  useRealtimeNotifications(user?.id ?? null);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/(auth)/welcome');
      return;
    }

    if (role === 'customer') {
      router.replace('/(customer)/(tabs)');
      return;
    }

    // Gate: only redirect brand-new runners (no runner_profile yet) to
    // onboarding. Anyone with a profile \u2014 regardless of verification
    // status (pending / approved / rejected / resubmit) \u2014 has already
    // completed signup; they belong on the tabs, where the verification
    // banner will surface any required action.
    // Verification gate. The backend auto-creates a bare runner_profile
    // (verification_status 'pending', zero documents) the instant an account
    // becomes a runner, so "has a profile" never proves signup is done. Force
    // runners to the document-upload (onboarding) screen until the two required
    // documents are uploaded and not rejected; approved runners always pass.
    // `documents` rides only on the GET /user/profile payload (not the
    // login/OTP response) — while it hasn't loaded we let the runner through
    // rather than trap them on a spinner; validateSession refetches the full
    // profile and this effect re-runs once documents arrive, redirecting then
    // if still incomplete.
    const isOnboarding = segments.includes('onboarding' as never);
    if (!isOnboarding) {
      const profile = user?.runner_profile;
      if (!profile) {
        router.replace('/(runner)/onboarding');
        return;
      }
      const docs = profile.documents;
      if (profile.verification_status !== 'approved' && Array.isArray(docs)) {
        const hasRequiredDocs = REQUIRED_RUNNER_DOC_TYPES.every((type) =>
          docs.some((d) => d.document_type === type && d.status !== 'rejected'),
        );
        if (!hasRequiredDocs) {
          router.replace('/(runner)/onboarding');
          return;
        }
      }
    }

    setReady(true);
  }, [isAuthenticated, role, user, router, segments]);

  if (!isAuthenticated || role === 'customer') {
    return null;
  }

  // Show loading until navigation check completes — prevents tabs from fetching before redirect
  const isOnboarding = segments.includes('onboarding' as never);
  if (!ready && !isOnboarding) {
    return (
      <View className="flex-1 bg-background">
        <CenteredLoader />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false, animation: STACK_ANIMATION }} />;
}
